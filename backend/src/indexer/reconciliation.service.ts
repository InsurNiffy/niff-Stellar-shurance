/**
 * ReconciliationService — scheduled job that verifies vote tally columns
 * match the COUNT of individual vote rows, and that appeal bookkeeping
 * (appealsCount / appealTxHash) matches the indexed on-chain status.
 *
 * Discrepancies indicate a partial-failure bug in the indexer or an
 * optimistic appeal write that never confirmed on-chain, and must be
 * resolved before finalization display is shown as authoritative.
 *
 * Safe to run concurrently with live ingestion: uses READ COMMITTED isolation
 * and only updates claims where a real discrepancy exists.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics/metrics.service';

export interface ReconciliationResult {
  checkedAt: Date;
  totalChecked: number;
  discrepancies: number;
  discrepantClaimIds: number[];
  /** Number of appeal-field corrections applied in the last run. */
  appealCorrections: number;
  ok: boolean;
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private lastResult: ReconciliationResult | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  getLastResult(): ReconciliationResult | null {
    return this.lastResult;
  }

  /** Returns the reconciliation status for a single claim. */
  async getClaimReconciliationStatus(
    claimId: number,
  ): Promise<{ ok: boolean; storedApprove: number; storedReject: number; countApprove: number; countReject: number }> {
    const [claim, countApprove, countReject] = await Promise.all([
      this.prisma.claim.findUnique({
        where: { id: claimId },
        select: { approveVotes: true, rejectVotes: true },
      }),
      this.prisma.vote.count({ where: { claimId, vote: 'APPROVE' } }),
      this.prisma.vote.count({ where: { claimId, vote: 'REJECT' } }),
    ]);

    if (!claim) {
      return { ok: true, storedApprove: 0, storedReject: 0, countApprove: 0, countReject: 0 };
    }

    return {
      ok: claim.approveVotes === countApprove && claim.rejectVotes === countReject,
      storedApprove: claim.approveVotes,
      storedReject: claim.rejectVotes,
      countApprove,
      countReject,
    };
  }

  /** Runs every 5 minutes. Safe to run concurrently with live ingestion. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async runReconciliation(): Promise<ReconciliationResult> {
    this.logger.log('Starting vote tally reconciliation...');

    // Fetch all non-finalized claims with their stored tallies and appeal fields.
    const claims = await this.prisma.claim.findMany({
      where: { isFinalized: false },
      select: {
        id: true,
        approveVotes: true,
        rejectVotes: true,
        status: true,
        appealsCount: true,
        appealTxHash: true,
      },
    });

    const discrepantIds: number[] = [];
    let appealCorrections = 0;

    for (const claim of claims) {
      const [countApprove, countReject] = await Promise.all([
        this.prisma.vote.count({ where: { claimId: claim.id, vote: 'APPROVE' } }),
        this.prisma.vote.count({ where: { claimId: claim.id, vote: 'REJECT' } }),
      ]);

      if (claim.approveVotes !== countApprove || claim.rejectVotes !== countReject) {
        discrepantIds.push(claim.id);
        this.logger.warn(
          `Tally discrepancy on claim ${claim.id}: ` +
            `stored=(approve=${claim.approveVotes}, reject=${claim.rejectVotes}) ` +
            `actual=(approve=${countApprove}, reject=${countReject}). Correcting...`,
        );

        // Self-heal: correct the tally atomically.
        await this.prisma.claim.update({
          where: { id: claim.id },
          data: { approveVotes: countApprove, rejectVotes: countReject },
        });
      }

      // ── Appeal field drift (issue #1319) ────────────────────────────────────
      // appealsCount/appealTxHash are written optimistically in
      // ClaimsService.submitAppealTransaction before on-chain confirmation. The
      // indexer mirrors on-chain truth into `status`: only a claim the contract
      // actually placed in UnderAppeal has an open appeal, and the contract
      // enforces MAX_APPEALS_PER_CLAIM = 1 (so at most one appeal ever opens).
      // Resolved appeals are finalized (isFinalized = true) and therefore
      // excluded from this pass. A non-finalized claim not in UNDER_APPEAL thus
      // cannot have an opened appeal — a residual appealsCount/appealTxHash is
      // drift from an optimistic write that never confirmed on-chain.
      const expectedAppealsCount = claim.status === 'UNDER_APPEAL' ? 1 : 0;

      if (claim.appealsCount !== expectedAppealsCount) {
        discrepantIds.push(claim.id);
        appealCorrections += 1;
        this.logger.warn(
          `Appeal field discrepancy on claim ${claim.id}: ` +
            `stored appealsCount=${claim.appealsCount} status=${claim.status} ` +
            `expected appealsCount=${expectedAppealsCount}. Correcting...`,
        );

        // Self-heal: reset the optimistic appeal bookkeeping to the indexed
        // on-chain state. A residual txHash with no open appeal means the
        // optimistic submission never confirmed — clear it as well.
        await this.prisma.claim.update({
          where: { id: claim.id },
          data: {
            appealsCount: expectedAppealsCount,
            ...(expectedAppealsCount === 0 && claim.appealTxHash != null
              ? { appealTxHash: null }
              : {}),
          },
        });

        this.metrics?.recordAppealReconciliationCorrection(claim.id);
      }
    }

    const result: ReconciliationResult = {
      checkedAt: new Date(),
      totalChecked: claims.length,
      discrepancies: discrepantIds.length,
      discrepantClaimIds: discrepantIds,
      appealCorrections,
      ok: discrepantIds.length === 0,
    };

    this.lastResult = result;

    if (discrepantIds.length > 0) {
      this.logger.error(
        `Reconciliation found ${discrepantIds.length} discrepant claim(s): [${discrepantIds.join(', ')}]. ` +
          `Stored tallies/appeal fields have been corrected. Investigate indexer for partial-failure bugs.`,
      );
    } else {
      this.logger.log(`Reconciliation OK — ${claims.length} claims checked, no discrepancies.`);
    }

    return result;
  }
}
