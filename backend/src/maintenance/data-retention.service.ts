import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Removes stale materialized and indexer rows beyond their retention windows.
 *
 * Materialized rows (votes/claims/policies): hard-deleted when `deletedAt <= cutoff`
 * controlled by DATA_RETENTION_DAYS (default 730).
 *
 * Indexer rows (RawEvent + LedgerCursor): pruned by INDEXER_RETENTION_DAYS (default 90)
 * using `ledgerClosedAt` / `updatedAt` respectively (issue #897).
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

    const indexerDays = this.config.get<number>('INDEXER_RETENTION_DAYS', 90);
    const indexerCutoff = this.computeCutoff(indexerDays);
    const indexerSummary = await this.pruneIndexerRowsBefore(indexerCutoff);
    if (indexerSummary.rawEvents + indexerSummary.ledgerCursors > 0) {
      this.logger.log(
        `Indexer retention purge: rawEvents=${indexerSummary.rawEvents} ledgerCursors=${indexerSummary.ledgerCursors} (cutoff=${indexerCutoff.toISOString()})`,
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

  /**
   * Delete old indexer rows beyond the retention window (issue #897).
   *
   * RawEvent rows are pruned by `ledgerClosedAt` — events far enough in the
   * past can be replayed from chain if needed, so removal keeps the DB lean.
   *
   * LedgerCursor rows track per-network progress and have one row per network.
   * Cursors whose `updatedAt` is older than the retention window belong to
   * retired / inactive networks and are safe to remove.
   */
  async pruneIndexerRowsBefore(cutoff: Date): Promise<{
    rawEvents: number;
    ledgerCursors: number;
  }> {
    const re = await this.prisma.rawEvent.deleteMany({
      where: { ledgerClosedAt: { lte: cutoff } },
    });
    const lc = await this.prisma.ledgerCursor.deleteMany({
      where: { updatedAt: { lte: cutoff } },
    });
    return { rawEvents: re.count, ledgerCursors: lc.count };
  }
}
