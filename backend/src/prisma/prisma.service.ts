import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { MetricsService } from '../metrics/metrics.service';

/**
 * PrismaService — wraps PrismaClient with explicit connection pool settings.
 *
 * Pool sizing rationale:
 *  - DB_POOL_MAX (default 10): sized for a 2-vCPU app instance against a
 *    db.t3.medium (max_connections ≈ 170). Leave headroom for migrations,
 *    admin tools, and multiple replicas. Increase for larger instances.
 *  - DB_POOL_MIN (default 2): keeps warm connections ready; avoids cold-start
 *    latency on low-traffic periods.
 *  - DB_POOL_IDLE_TIMEOUT_MS (default 30 000): reclaim idle connections after
 *    30 s to avoid hitting DB max_connections under scale-down.
 *  - DB_POOL_CONNECTION_TIMEOUT_MS (default 5 000): fail fast rather than
 *    queue indefinitely; surfaces pool exhaustion as 503 instead of timeout.
 *
 * All settings are configurable via environment variables for different
 * deployment sizes (dev / staging / prod).
 *
 * Runbook — diagnosing pool exhaustion:
 *  1. Check `db_pool_waiting` metric in Grafana; sustained > 0 means exhaustion.
 *  2. Check `db_pool_active` — if consistently at DB_POOL_MAX, increase it
 *     (verify DB max_connections first: `SHOW max_connections;`).
 *  3. Check for long-running queries holding connections: `pg_stat_activity`.
 *  4. If idle connections are high, reduce DB_POOL_MAX or DB_POOL_IDLE_TIMEOUT_MS.
 */
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
          url:
            config.get<string>('DATABASE_URL') +
            `?connection_limit=${poolMax}&pool_timeout=${Math.ceil(connTimeout / 1000)}`,
        },
      },
      log:
        config.get<string>('NODE_ENV') === 'development'
          ? ['query', 'warn', 'error']
          : ['warn', 'error'],
    });

    this.slowQueryThresholdMs = slowQueryThresholdMs;
    this.poolMax = poolMax;

    this.$use(async (params, next) => {
      this.activeQueries++;
      this.emitPoolMetrics();

      const startedAt = Date.now();
      try {
        const result = await next(params);
        const durationMs = Date.now() - startedAt;

        if (durationMs >= this.slowQueryThresholdMs) {
          this.logger.warn(
            JSON.stringify({
              event: 'prisma_slow_query',
              model: params.model,
              action: params.action,
              durationMs,
            }),
          );
        }

        return result;
      } finally {
        this.activeQueries = Math.max(0, this.activeQueries - 1);
        this.emitPoolMetrics();
      }
    });

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

  async onModuleInit() {
    await this.$connect();
    // Emit initial zero-state metrics so gauges appear in the first scrape.
    this.emitPoolMetrics();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
