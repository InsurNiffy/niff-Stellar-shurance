import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaReplicaService } from '../prisma/prisma-replica.service';

/** Timeout for the DB health probe — short enough to not hold a connection open. */
const DB_HEALTH_TIMEOUT_MS = 2_000;

@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly prismaReplica: PrismaReplicaService,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await Promise.race([
        this.prismaService.$queryRaw`SELECT 1`,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`DB health check timed out after ${DB_HEALTH_TIMEOUT_MS}ms`)),
            DB_HEALTH_TIMEOUT_MS,
          ),
        ),
      ]);

      const details: Record<string, unknown> = { primary: 'healthy' };

      // Check replica health if configured
      if (this.prismaReplica.isEnabled()) {
        try {
          await Promise.race([
            this.prismaReplica.$queryRaw`SELECT 1`,
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Replica health check timed out`)),
                DB_HEALTH_TIMEOUT_MS,
              ),
            ),
          ]);
          details.replica = 'healthy';
          details.replica_lag_ms = this.prismaReplica.getReplicaLagMs();
        } catch (err) {
          details.replica = 'unhealthy';
          details.replica_error = err instanceof Error ? err.message : 'Unknown error';
        }
      }

      return this.getStatus(key, true, details);
    } catch (error) {
      throw new HealthCheckError(
        'Prisma check failed',
        this.getStatus(key, false, {
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      );
    }
  }
}
