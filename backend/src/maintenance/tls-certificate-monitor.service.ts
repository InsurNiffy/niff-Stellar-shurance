import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { CertificateCheckerService, CertificateCheckResult } from '../common/tls/certificate-checker.service';
import { RedisService } from '../cache/redis.service';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Alert tier types for certificate expiry.
 */
export type AlertTier = 'tier_1' | 'tier_2';

/**
 * Configuration for a single endpoint to monitor.
 */
export interface TlsEndpointConfig {
  hostname: string;
  port?: number;
  description?: string;
}

/**
 * Alert event that will be sent via webhook.
 */
export interface TlsCertificateAlertEvent {
  event: 'tls_certificate_expiry_alert';
  severity: 'warning' | 'critical';
  tier: 1 | 2;
  hostname: string;
  port: number;
  expiryDate: string;
  daysRemaining: number;
  alertedAt: string;
  message: string;
}

/**
 * Monitor snapshot: persisted state of the latest run.
 */
export interface TlsCertificateMonitorSnapshot {
  checkedAt: string;
  endpointsChecked: number;
  expiringAlerts: Array<{
    hostname: string;
    tier: AlertTier;
    daysRemaining: number;
    expiryDate: string;
  }>;
  unreachableEndpoints: string[];
  summary: string;
}

/**
 * TLS Certificate Monitor Service.
 * Runs on a schedule to check public endpoints' TLS certificates for expiry,
 * firing tiered alerts (30 days, 7 days) with per-threshold re-fire suppression.
 */
@Injectable()
export class TlsCertificateMonitorService {
  private readonly logger = new Logger(TlsCertificateMonitorService.name);

  // Redis key prefixes
  private readonly ALERT_KEY_PREFIX = 'tls:alert';
  private readonly SNAPSHOT_KEY = 'tls:monitor:snapshot';
  private readonly SNAPSHOT_TTL_SECONDS = 86400; // 24 hours

  // Default alert thresholds (days before expiry)
  private readonly TIER_1_THRESHOLD_DAYS = 30;
  private readonly TIER_2_THRESHOLD_DAYS = 7;

  constructor(
    private readonly config: ConfigService,
    private readonly certChecker: CertificateCheckerService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Scheduled job: run certificate monitor daily at 02:00 UTC.
   * Cron expression can be overridden via TLS_CERT_MONITOR_CRON.
   */
  @Cron('0 2 * * *') // 02:00 daily
  async runScheduledCertificateMonitor(): Promise<void> {
    await this.runCertificateMonitor();
  }

  /**
   * Main entry point: check all configured endpoints and fire alerts.
   * Public for manual triggers and tests.
   */
  async runCertificateMonitor(): Promise<TlsCertificateMonitorSnapshot> {
    const enabled = this.config.get<string>('TLS_CERT_MONITOR_ENABLED', 'true');
    if (enabled !== 'true' && enabled !== '1') {
      this.logger.log('[tls-monitor] disabled via TLS_CERT_MONITOR_ENABLED');
      return {
        checkedAt: new Date().toISOString(),
        endpointsChecked: 0,
        expiringAlerts: [],
        unreachableEndpoints: [],
        summary: 'Monitor disabled',
      };
    }

    const endpoints = await this.loadEndpointsConfig();
    if (!endpoints || endpoints.length === 0) {
      this.logger.warn('[tls-monitor] no endpoints configured');
      return {
        checkedAt: new Date().toISOString(),
        endpointsChecked: 0,
        expiringAlerts: [],
        unreachableEndpoints: [],
        summary: 'No endpoints configured',
      };
    }

    this.logger.log(`[tls-monitor] checking ${endpoints.length} endpoint(s)`);

    // Check all endpoints.
    const hostnames = endpoints.map((ep) => ep.hostname);
    const checkResults = await this.certChecker.checkCertificatesExpiry(
      hostnames,
      443,
      this.config.get<number>('TLS_CERT_MONITOR_CONCURRENCY', 5),
    );

    // Map results back to endpoint configs for more context.
    const resultsWithConfig = checkResults.map((result) => {
      const config = endpoints.find((ep) => ep.hostname === result.hostname);
      return { ...result, config };
    });

    // Process results and fire alerts.
    const expiringAlerts: Array<{
      hostname: string;
      tier: AlertTier;
      daysRemaining: number;
      expiryDate: string;
    }> = [];
    const unreachableEndpoints: string[] = [];

    for (const item of resultsWithConfig) {
      const { hostname, status, daysRemaining, expiryDate, error, config } = item;

      if (status === 'unreachable') {
        unreachableEndpoints.push(hostname);
        this.logger.warn(
          `[tls-monitor] endpoint unreachable: ${hostname} (${error})`,
        );
        continue;
      }

      if (status === 'ok') {
        this.logger.debug(
          `[tls-monitor] ${hostname}: ${daysRemaining} days remaining`,
        );
        continue;
      }

      // Certificate is expiring soon; check alert tiers.
      const tier1Threshold = this.config.get<number>(
        'TLS_CERT_EXPIRY_ALERT_DAYS_TIER_1',
        this.TIER_1_THRESHOLD_DAYS,
      );
      const tier2Threshold = this.config.get<number>(
        'TLS_CERT_EXPIRY_ALERT_DAYS_TIER_2',
        this.TIER_2_THRESHOLD_DAYS,
      );

      // Check Tier 1 (30 days).
      if (daysRemaining! <= tier1Threshold) {
        const alertFired = await this.checkAndFireAlert(
          hostname,
          'tier_1',
          1,
          daysRemaining!,
          expiryDate!,
        );
        if (alertFired) {
          expiringAlerts.push({
            hostname,
            tier: 'tier_1',
            daysRemaining: daysRemaining!,
            expiryDate: expiryDate!,
          });
        }
      }

      // Check Tier 2 (7 days).
      if (daysRemaining! <= tier2Threshold) {
        const alertFired = await this.checkAndFireAlert(
          hostname,
          'tier_2',
          2,
          daysRemaining!,
          expiryDate!,
        );
        if (alertFired) {
          expiringAlerts.push({
            hostname,
            tier: 'tier_2',
            daysRemaining: daysRemaining!,
            expiryDate: expiryDate!,
          });
        }
      }
    }

    // Persist snapshot.
    const snapshot: TlsCertificateMonitorSnapshot = {
      checkedAt: new Date().toISOString(),
      endpointsChecked: endpoints.length,
      expiringAlerts,
      unreachableEndpoints,
      summary: `Checked ${endpoints.length} endpoints: ${expiringAlerts.length} expiring, ${unreachableEndpoints.length} unreachable`,
    };

    await this.redis.set(this.SNAPSHOT_KEY, snapshot, this.SNAPSHOT_TTL_SECONDS);

    this.logger.log(
      `[tls-monitor] summary: ${snapshot.summary}`,
    );

    return snapshot;
  }

  /**
   * Check if an alert has already been fired for this endpoint:tier combination.
   * If not, fire the alert and record it; return true.
   * If already fired (and TTL not expired), return false (suppressed).
   */
  private async checkAndFireAlert(
    hostname: string,
    tier: AlertTier,
    tierNumber: 1 | 2,
    daysRemaining: number,
    expiryDate: string,
  ): Promise<boolean> {
    const alertKey = `${this.ALERT_KEY_PREFIX}:${hostname}:${tier}`;

    // Check if alert was already fired.
    const alreadyFired = await this.redis.get(alertKey);
    if (alreadyFired) {
      this.logger.debug(
        `[tls-monitor] ${hostname} ${tier}: alert already fired, suppressing`,
      );
      return false;
    }

    // Fire the alert.
    const alertEvent: TlsCertificateAlertEvent = {
      event: 'tls_certificate_expiry_alert',
      severity: tierNumber === 1 ? 'warning' : 'critical',
      tier: tierNumber,
      hostname,
      port: 443,
      expiryDate,
      daysRemaining,
      alertedAt: new Date().toISOString(),
      message: `TLS certificate for ${hostname} expires in ${daysRemaining} days (${expiryDate})`,
    };

    await this.sendAlert(alertEvent);

    // Record alert in Redis with TTL equal to time-to-expiry.
    // This prevents re-firing until the certificate actually expires.
    const expiryDateObj = new Date(expiryDate);
    const now = new Date();
    const secondsUntilExpiry = Math.max(
      1,
      Math.floor((expiryDateObj.getTime() - now.getTime()) / 1000),
    );

    await this.redis.set(
      alertKey,
      JSON.stringify({
        tier,
        firedAt: new Date().toISOString(),
        daysRemaining,
      }),
      secondsUntilExpiry,
    );

    this.logger.warn(
      `[tls-monitor] ${hostname} ${tier}: alert fired (${daysRemaining} days remaining)`,
    );

    return true;
  }

  /**
   * Send alert via webhook (if configured), or log if not.
   */
  private async sendAlert(alert: TlsCertificateAlertEvent): Promise<void> {
    const webhookUrl = this.config.get<string>('TLS_CERT_ALERT_WEBHOOK_URL')?.trim();
    if (!webhookUrl) {
      this.logger.warn(
        `[tls-monitor] TLS_CERT_ALERT_WEBHOOK_URL not set — alert logged only`,
      );
      return;
    }

    const { default: axios } = await import('axios');
    const secret = this.config.get<string>('TLS_CERT_ALERT_WEBHOOK_SECRET', '');

    try {
      await axios.post(
        webhookUrl,
        alert,
        {
          headers: secret
            ? { 'X-Webhook-Secret': secret }
            : undefined,
          timeout: 10_000,
        },
      );
      this.logger.log(`[tls-monitor] webhook alert sent for ${alert.hostname}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[tls-monitor] webhook delivery failed for ${alert.hostname}: ${msg}`,
      );
    }
  }

  /**
   * Load endpoint configuration from file or environment variable.
   * Priority: TLS_ENDPOINTS_JSON env var > config/tls-endpoints.json file > empty
   */
  private async loadEndpointsConfig(): Promise<TlsEndpointConfig[]> {
    // Try environment variable first.
    const envJson = this.config.get<string>('TLS_ENDPOINTS_JSON');
    if (envJson) {
      try {
        return JSON.parse(envJson);
      } catch (err) {
        this.logger.error(`[tls-monitor] failed to parse TLS_ENDPOINTS_JSON: ${err}`);
      }
    }

    // Try config file.
    const configPath = this.config.get<string>(
      'TLS_ENDPOINTS_CONFIG_PATH',
      'config/tls-endpoints.json',
    );
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const data = JSON.parse(content);
      return data.endpoints || [];
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT')) {
        this.logger.debug(
          `[tls-monitor] config file not found: ${configPath}`,
        );
      } else {
        this.logger.warn(
          `[tls-monitor] error loading config from ${configPath}: ${msg}`,
        );
      }
    }

    return [];
  }

  /**
   * Fetch the latest snapshot (dashboard view).
   */
  async getLatestSnapshot(): Promise<TlsCertificateMonitorSnapshot | null> {
    return this.redis.get<TlsCertificateMonitorSnapshot>(this.SNAPSHOT_KEY);
  }
}
