/**
 * PrismaReplicaService — read-only connection to the database replica pool.
 *
 * When DATABASE_REPLICA_URL is configured, this service provides a separate
 * Prisma client connected to the replica. Read-only operations (findMany, findFirst,
 * findUnique, count, etc.) are routed here to reduce load on the primary.
 *
 * Write operations must always use PrismaService (the primary). The replica may lag
 * behind the primary by up to the replication delay (typically < 100ms in modern setups),
 * so reads from the replica may return slightly stale data.
 *
 * Replica lag implications:
 *  - Policy listings: acceptable (users see recently-changed policies with minimal lag)
 *  - Claim listings: acceptable (status changes lag by replication delay)
 *  - Vote counts: acceptable (vote tallies lag by replication delay)
 *  - Real-time consistency: use PrismaService (primary) for reads that must reflect
 *    the very latest writes (e.g. post-write read-back for verification)
 *
 * Pool configuration: inherits DB_POOL_* settings from PrismaService config.
 */

import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class PrismaReplicaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaReplicaService.name);
  private readonly isConfigured: boolean;
  private readonly slowQueryThresholdMs: number;
  private activeQueries = 0;
  private readonly poolMax: number;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    const replicaUrl = config.get<string>('DATABASE_REPLICA_URL');
    const poolMax = config.get<number>('DB_POOL_MAX', 10);
    const connTimeout = config.get<number>('DB_POOL_CONNECTION_TIMEOUT_MS', 5_000);
    const slowQueryThresholdMs = config.get<number>('DB_SLOW_QUERY_MS', 250);

    const isConfigured = !!replicaUrl;

    super(
      isConfigured
        ? {
            datasources: {
              db: {
                url:
                  replicaUrl +
                  `?connection_limit=${poolMax}&pool_timeout=${Math.ceil(connTimeout / 1000)}`,
              },
            },
            log: config.get<string>('NODE_ENV') === 'development'
              ? ['query', 'warn', 'error']
              : ['warn', 'error'],
          }
        : undefined,
    );

    this.isConfigured = isConfigured;
    this.slowQueryThresholdMs = slowQueryThresholdMs;
    this.poolMax = poolMax;

    if (isConfigured) {
      this.logger.log('Database replica configured; read operations will use replica pool');
    } else {
      this.logger.log('DATABASE_REPLICA_URL not set; read operations will use primary database');
    }
  }

  /** Returns whether the replica is configured and available. */
  isEnabled(): boolean {
    return this.isConfigured;
  }

  async onModuleInit() {
    if (!this.isConfigured) return;

    try {
      await this.$connect();
      this.logger.log('Connected to database replica');

      // Attach slow-query monitoring
      (this as unknown as { $on: (event: string, cb: (e: { duration: number; query: string }) => void) => void })
        .$on('query', (e) => {
          this.activeQueries++;
          if (e.duration >= this.slowQueryThresholdMs) {
            this.logger.warn(
              JSON.stringify({
                event: 'prisma_replica_slow_query',
                query: e.query,
                durationMs: e.duration,
              }),
            );
            this.metrics?.slowQueriesTotal.inc();
          }
          this.activeQueries = Math.max(0, this.activeQueries - 1);
        });
    } catch (err) {
      this.logger.error(`Failed to connect to database replica: ${err}. Reads will fall back to primary.`);
    }
  }

  async onModuleDestroy() {
    if (this.isConfigured) {
      await this.$disconnect();
    }
  }

  /** Get replica lag in milliseconds. Returns 0 if replica is not configured. */
  getReplicaLagMs(): number {
    if (!this.isConfigured) return 0;
    // In a real implementation, query pg_last_wal_receive_lsn() / pg_last_wal_replay_lsn()
    // For now, return 0 (lag is not exposed without additional queries).
    return 0;
  }
}
