import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as tls from 'tls';

export interface TlsEndpointConfig {
  name: string;
  host: string;
  port?: number;
  servername?: string;
}

export interface TlsCertificateStatus {
  name: string;
  host: string;
  port: number;
  valid: boolean;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  status: 'ok' | 'warning' | 'critical' | 'expired' | 'error';
  error?: string;
  checkedAt: string;
}

export interface TlsMonitorReport {
  checkedAt: string;
  endpoints: TlsCertificateStatus[];
  healthy: boolean;
}

const WARNING_DAYS = 30;
const CRITICAL_DAYS = 7;
const DEFAULT_PORT = 443;
const DEFAULT_CONFIG_PATH = path.join(
  process.cwd(),
  'config',
  'tls-endpoints.example.json',
);
const DEFAULT_STATUS_PATH = path.join(
  process.cwd(),
  'ops',
  '.secret-rotation-dates.json',
);

@Injectable()
export class TlsCertificateMonitorService {
  private readonly logger = new Logger(TlsCertificateMonitorService.name);
  private readonly configPath: string;
  private readonly statusPath: string;
  private lastReport: TlsMonitorReport | null = null;

  constructor() {
    this.configPath = process.env.TLS_ENDPOINTS_CONFIG || DEFAULT_CONFIG_PATH;
    this.statusPath = process.env.SECRET_ROTATION_DATES_PATH || DEFAULT_STATUS_PATH;
  }

  async loadEndpoints(): Promise<TlsEndpointConfig[]> {
    const raw = await fs.readFile(this.configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const endpoints: TlsEndpointConfig[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.endpoints)
        ? parsed.endpoints
        : [];
    return endpoints.filter((e) => e && typeof e.host === 'string');
  }

  async checkEndpoint(endpoint: TlsEndpointConfig): Promise<TlsCertificateStatus> {
    const port = endpoint.port ?? DEFAULT_PORT;
    const checkedAt = new Date().toISOString();
    try {
      const cert = await this.fetchCertificate(endpoint.host, port, endpoint.servername);
      const expiresAt = cert.valid_to ? new Date(cert.valid_to) : null;
      const daysUntilExpiry = expiresAt
        ? Math.floor((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null;
      const status = this.classify(daysUntilExpiry);
      if (status === 'critical' || status === 'expired') {
        this.logger.error(
          `TLS certificate for ${endpoint.name} (${endpoint.host}:${port}) ${status}: ${daysUntilExpiry} day(s) until expiry`,
        );
      } else if (status === 'warning') {
        this.logger.warn(
          `TLS certificate for ${endpoint.name} (${endpoint.host}:${port}) expires in ${daysUntilExpiry} day(s)`,
        );
      }
      return {
        name: endpoint.name,
        host: endpoint.host,
        port,
        valid: status !== 'expired',
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        daysUntilExpiry,
        status,
        checkedAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to check TLS certificate for ${endpoint.name} (${endpoint.host}:${port}): ${message}`,
      );
      return {
        name: endpoint.name,
        host: endpoint.host,
        port,
        valid: false,
        expiresAt: null,
        daysUntilExpiry: null,
        status: 'error',
        error: message,
        checkedAt,
      };
    }
  }

  async runCheck(): Promise<TlsMonitorReport> {
    const endpoints = await this.loadEndpoints();
    const results: TlsCertificateStatus[] = [];
    for (const endpoint of endpoints) {
      results.push(await this.checkEndpoint(endpoint));
    }
    const report: TlsMonitorReport = {
      checkedAt: new Date().toISOString(),
      endpoints: results,
      healthy: results.every((r) => r.status === 'ok' || r.status === 'warning'),
    };
    this.lastReport = report;
    await this.recordStatus(report);
    return report;
  }

  getLastReport(): TlsMonitorReport | null {
    return this.lastReport;
  }

  async getHealthStatus(): Promise<{
    status: 'up' | 'degraded' | 'down';
    certificates: TlsCertificateStatus[];
  }> {
    const report = this.lastReport ?? (await this.runCheck());
    const hasExpired = report.endpoints.some(
      (e) => e.status === 'expired' || e.status === 'error',
    );
    const hasCritical = report.endpoints.some((e) => e.status === 'critical');
    const status = hasExpired ? 'down' : hasCritical ? 'degraded' : 'up';
    return { status, certificates: report.endpoints };
  }

  private classify(daysUntilExpiry: number | null): TlsCertificateStatus['status'] {
    if (daysUntilExpiry === null) {
      return 'error';
    }
    if (daysUntilExpiry < 0) {
      return 'expired';
    }
    if (daysUntilExpiry <= CRITICAL_DAYS) {
      return 'critical';
    }
    if (daysUntilExpiry <= WARNING_DAYS) {
      return 'warning';
    }
    return 'ok';
  }

  private fetchCertificate(
    host: string,
    port: number,
    servername?: string,
  ): Promise<tls.PeerCertificate> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          host,
          port,
          servername: servername ?? host,
          rejectUnauthorized: false,
        },
        () => {
          const cert = socket.getPeerCertificate();
          socket.end();
          if (!cert || Object.keys(cert).length === 0) {
            reject(new Error('No peer certificate returned'));
            return;
          }
          resolve(cert);
        },
      );
      socket.setTimeout(10000, () => {
        socket.destroy();
        reject(new Error('TLS connection timed out'));
      });
      socket.on('error', (err) => reject(err));
    });
  }

  private async recordStatus(report: TlsMonitorReport): Promise<void> {
    let existing: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(this.statusPath, 'utf8');
      existing = JSON.parse(raw);
    } catch {
      existing = {};
    }
    const tlsStatus: Record<string, unknown> = {
      lastCheckedAt: report.checkedAt,
      endpoints: report.endpoints.map((e) => ({
        name: e.name,
        host: e.host,
        port: e.port,
        status: e.status,
        expiresAt: e.expiresAt,
        daysUntilExpiry: e.daysUntilExpiry,
        checkedAt: e.checkedAt,
      })),
    };
    const merged = { ...existing, tlsCertificates: tlsStatus };
    await fs.mkdir(path.dirname(this.statusPath), { recursive: true });
    await fs.writeFile(this.statusPath, JSON.stringify(merged, null, 2), 'utf8');
  }
}
