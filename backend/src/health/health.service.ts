import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import Redis from 'ioredis';

export type DependencyStatus = 'up' | 'down' | 'degraded';

export interface DependencyCheckResult {
  status: DependencyStatus;
  latencyMs: number;
  message?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'error';
  checks: Record<string, DependencyCheckResult>;
  timestamp: string;
}

const DEFAULT_TIMEOUT_MS = 3000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get timeoutMs(): number {
    const raw = this.config.get<string>('HEALTH_CHECK_TIMEOUT_MS');
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
  }

  private async withTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
  ): Promise<{ ok: true; value: T } | { ok: false; timedOut: boolean; error?: unknown }> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const value = await Promise.race<T>([
        fn(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        }),
      ]);
      return { ok: true, value };
    } catch (error) {
      const timedOut = error instanceof Error && error.message === 'timeout';
      return { ok: false, timedOut, error };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async runCheck(
    name: string,
    fn: () => Promise<unknown>,
  ): Promise<DependencyCheckResult> {
    const started = Date.now();
    const result = await this.withTimeout(fn, this.timeoutMs);
    const latencyMs = Date.now() - started;

    if (result.ok) {
      return { status: 'up', latencyMs };
    }

    if (result.timedOut) {
      this.logger.warn(`Health check "${name}" timed out after ${this.timeoutMs}ms`);
      return {
        status: 'degraded',
        latencyMs,
        message: `timed out after ${this.timeoutMs}ms`,
      };
    }

    const message = result.error instanceof Error ? result.error.message : 'unreachable';
    this.logger.warn(`Health check "${name}" failed: ${message}`);
    return { status: 'down', latencyMs, message };
  }

  private async checkPrisma(): Promise<DependencyCheckResult> {
    return this.runCheck('database', () => this.prisma.$queryRaw`SELECT 1`);
  }

  private async checkRedis(): Promise<DependencyCheckResult> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      return { status: 'degraded', latencyMs: 0, message: 'REDIS_URL not configured' };
    }

    return this.runCheck('redis', async () => {
      const client = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: this.timeoutMs,
      });
      try {
        await client.connect();
        const pong = await client.ping();
        if (pong !== 'PONG') {
          throw new Error(`unexpected PING response: ${pong}`);
        }
      } finally {
        client.disconnect();
      }
    });
  }

  private async checkSorobanRpc(): Promise<DependencyCheckResult> {
    const url = this.config.get<string>('SOROBAN_RPC_URL');
    if (!url) {
      return { status: 'degraded', latencyMs: 0, message: 'SOROBAN_RPC_URL not configured' };
    }

    return this.runCheck('soroban_rpc', async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
      } finally {
        clearTimeout(timer);
      }
    });
  }

  private async checkHorizon(): Promise<DependencyCheckResult> {
    const url = this.config.get<string>('HORIZON_URL');
    if (!url) {
      return { status: 'degraded', latencyMs: 0, message: 'HORIZON_URL not configured' };
    }

    return this.runCheck('horizon', async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(`${url.replace(/\/$/, '')}/`, {
          method: 'GET',
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
      } finally {
        clearTimeout(timer);
      }
    });
  }

  async checkLiveness(): Promise<{ status: 'ok'; timestamp: string }> {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  async checkReadiness(): Promise<HealthReport> {
    const [database, redis, sorobanRpc, horizon] = await Promise.all([
      this.checkPrisma(),
      this.checkRedis(),
      this.checkSorobanRpc(),
      this.checkHorizon(),
    ]);

    const checks: Record<string, DependencyCheckResult> = {
      database,
      redis,
      soroban_rpc: sorobanRpc,
      horizon,
    };

    const statuses = Object.values(checks).map((c) => c.status);
    let status: HealthReport['status'] = 'ok';
    if (statuses.includes('down')) {
      status = 'error';
    } else if (statuses.includes('degraded')) {
      status = 'degraded';
    }

    return { status, checks, timestamp: new Date().toISOString() };
  }
}
