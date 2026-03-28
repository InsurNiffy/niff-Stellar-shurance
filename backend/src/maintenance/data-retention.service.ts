import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Permanently removes materialized indexer rows that were soft-deleted longer
 * ago than DATA_RETENTION_DAYS. Idempotent and safe under concurrent ingestion:
 * only rows with non-null `deletedAt <= cutoff` are affected; live rows stay.
 *
 * Does not touch `raw_events` (append-only / reindex).
 */
@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async scheduledPurge(): Promise<void> {
    const days = this.config.get<number>('DATA_RETENTION_DAYS', 730);
    const cutoff = this.computeCutoff(days);
    const summary = await this.purgeMaterializedRowsDeletedBefore(cutoff);
    if (summary.policies + summary.claims + summary.votes > 0) {
      this.logger.log(
        `Data retention purge: policies=${summary.policies} claims=${summary.claims} votes=${summary.votes} (cutoff=${cutoff.toISOString()})`,
      );
    }
  }

  computeCutoff(retentionDays: number): Date {
    const ms = retentionDays * 86_400_000;
    return new Date(Date.now() - ms);
  }

  /**
   * Hard-delete soft-deleted materialized rows at or before `cutoff`.
   * FK order: votes → claims → policies.
   */
  async purgeMaterializedRowsDeletedBefore(cutoff: Date): Promise<{
    votes: number;
    claims: number;
    policies: number;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const vr = await tx.vote.deleteMany({
        where: { deletedAt: { lte: cutoff } },
      });
      const cr = await tx.claim.deleteMany({
        where: { deletedAt: { lte: cutoff } },
      });
      const pr = await tx.policy.deleteMany({
        where: { deletedAt: { lte: cutoff } },
      });
      return { votes: vr.count, claims: cr.count, policies: pr.count };
    });
  }
}
