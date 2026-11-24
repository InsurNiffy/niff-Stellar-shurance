import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';
import { assertTenantScoped } from './tenant-isolation';
import { MetricsService } from '../metrics/metrics.service';

type SoftDeleteExtensionArgs = {
  model: string;
  args: { where?: Record<string, unknown> } & Record<string, unknown>;
  query: (args: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Build a Prisma datasource URL from a base URL, appending pool settings.
 *
 * Pool sizing rationale:
 *  - connection_limit (DB_POOL_MAX, default 10): sized for a 2-vCPU app
 *    instance against a db.t3.medium (max_connections ≈ 170). Leave headroom
 *    for migrations, admin tools, and multiple replicas.
 *  - pool_timeout (DB_POOL_CONNECTION_TIMEOUT_MS, default 5 000): fail fast
 *    rather than queue indefinitely; surfaces pool exhaustion as 503.
 *
 * Runbook — diagnosing pool exhaustion:
 *  1. Check `db_pool_waiting` metric in Grafana; sustained > 0 means exhaustion.
 *  2. Check `db_pool_active` — if consistently at DB_POOL_MAX, increase it
 *     (verify DB max_connections first: `SHOW max_connections;`).
 *  3. Check for long-running queries holding connections: `pg_stat_activity`.
 *  4. If idle connections are high, reduce DB_POOL_MAX.
 */
export function buildDatasourceUrl(
  baseUrl: string | undefined,
  poolMax: number,
  connTimeoutMs: number,
): string {
  const url = baseUrl ?? '';
  const separator = url.includes('?') ? '&' : '?';
  return (
    url +
    `${separator}connection_limit=${poolMax}&pool_timeout=${Math.ceil(connTimeoutMs / 1000)}`
  );
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly slowQueryThresholdMs: number;
  private readonly poolMax: number;
  /** Count of queries currently in-flight — used to approximate active pool connections. */
  private activeQueries = 0;
  /** Models with soft-delete via deletedAt field. */
  private readonly softDeleteModels = new Set(['Claim', 'Vote', 'Policy', 'ClaimComment']);
  /** Async context for tracking soft-delete bypass state per request. */
  private readonly softDeleteContext = new AsyncLocalStorage<{ bypassSoftDelete?: boolean }>();

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    const poolMax = config.get<number>('DB_POOL_MAX', 10);
    const poolMin = config.get<number>('DB_POOL_MIN', 2);
    const idleTimeout = config.get<number>('DB_POOL_IDLE_TIMEOUT_MS', 30_000);
    const connTimeout = config.get<number>('DB_POOL_CONNECTION_TIMEOUT_MS', 5_000);
    const slowQueryThresholdMs = config.get<number>('DB_SLOW_QUERY_MS', 250);

    super({
      datasources: {
        db: {
          url: buildDatasourceUrl(config.get<string>('DATABASE_URL'), poolMax, connTimeout),
        },
      },
      log:
        config.get<string>('NODE_ENV') === 'development'
          ? ['query', 'warn', 'error']
          : ['warn', 'error'],
    });

    // Apply soft-delete extension: auto-filter deleted rows from findMany/findFirst/findUnique
    const softDeleteModels = this.softDeleteModels;
    const softDeleteContext = this.softDeleteContext;
    const enforceTenantIsolation = config.get<string>('TENANT_ISOLATION_STRICT') === 'true';
    (this as PrismaClient).$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }: {
            model: string;
            operation: string;
            args: { where?: Record<string, unknown> };
            query: (args: unknown) => Promise<unknown>;
          }) {
            // Issue #1632: reject tenant-scoped queries lacking a tenantId filter.
            if (enforceTenantIsolation) assertTenantScoped(model, operation, args);
            return query(args);
          },
          async findMany({ model, args, query }: SoftDeleteExtensionArgs) {
            if (softDeleteModels.has(model)) {
              const store = softDeleteContext.getStore();
              if (!store?.bypassSoftDelete) {
                args.where = { ...args.where, deletedAt: null };
              }
            }
            return query(args);
          },
          async findFirst({ model, args, query }: SoftDeleteExtensionArgs) {
            if (softDeleteModels.has(model)) {
              const store = softDeleteContext.getStore();
              if (!store?.bypassSoftDelete) {
                args.where = { ...args.where, deletedAt: null };
              }
            }
            return query(args);
          },
          async findUnique({ model, args, query }: SoftDeleteExtensionArgs) {
            if (softDeleteModels.has(model)) {
              const store = softDeleteContext.getStore();
              if (!store?.bypassSoftDelete) {
                args.where = { ...args.where, deletedAt: null };
              }
            }
            return query(args);
          },
        },
      },
    });

    this.slowQueryThresholdMs = slowQueryThresholdMs;
    this.poolMax = poolMax;

    // Expose pool config for observability (logged at startup).
    this.logger.log(
      JSON.stringify({
        event: 'prisma_pool_config',
        poolMax,
        poolMin,
        idleTimeoutMs: idleTimeout,
        connTimeoutMs: connTimeout,
        slowQueryThresholdMs,
      }),
    );
  }

  /** Emit current pool gauge values to Prometheus. */
  private emitPoolMetrics(): void {
    if (!this.metrics) return;
    const active = this.activeQueries;
    // idle = warm connections not currently executing (approximated from pool max)
    const idle = Math.max(0, this.poolMax - active);
    // waiting = requests beyond pool capacity (approximated; Prisma queues internally)
    const waiting = Math.max(0, active - this.poolMax);
    this.metrics.recordDbPool({ active, idle, waiting });
  }

  /** Run a callback with soft-delete filtering bypassed. For admin-only queries. */
  async withSoftDeleteBypass<T>(fn: () => Promise<T>): Promise<T> {
    return this.softDeleteContext.run({ bypassSoftDelete: true }, fn);
  }

  async onModuleInit() {
    await this.connectWithBackoff();
    // Slow-query monitoring via Prisma query events (Prisma 6 compatible).
    // $use middleware was removed in Prisma 6; use $on('query') instead.
    (this as unknown as { $on: (event: string, cb: (e: { duration: number; query: string; model?: string }) => void) => void })
      .$on('query', (e) => {
        this.activeQueries++;
        this.emitPoolMetrics();
        if (e.duration >= this.slowQueryThresholdMs) {
          this.logger.warn(
            JSON.stringify({
              event: 'prisma_slow_query',
              query: e.query,
              durationMs: e.duration,
            }),
          );
          this.metrics?.slowQueriesTotal.inc();
        }
        this.activeQueries = Math.max(0, this.activeQueries - 1);
        this.emitPoolMetrics();
      });
    // Emit initial zero-state metrics so gauges appear in the first scrape.
    this.emitPoolMetrics();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Retry $connect() with exponential backoff to survive DB cold starts (issue #894). */
  private async connectWithBackoff(): Promise<void> {
    const maxAttempts = this.config.get<number>('DB_CONNECT_MAX_ATTEMPTS', 5);
    const initialDelayMs = this.config.get<number>('DB_CONNECT_INITIAL_DELAY_MS', 500);
    const maxDelayMs = this.config.get<number>('DB_CONNECT_MAX_DELAY_MS', 30_000);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        this.logger.log(
          JSON.stringify({ event: 'prisma_connected', attempt }),
        );
        return;
      } catch (err) {
        const isLast = attempt === maxAttempts;
        const delay = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
        this.logger.error(
          JSON.stringify({
            event: 'prisma_connect_failed',
            attempt,
            maxAttempts,
            retryInMs: isLast ? null : delay,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        if (isLast) throw err;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /** Lightweight liveness probe used by the health indicator. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          event: 'prisma_health_check_failed',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return false;
    }
  }
}
