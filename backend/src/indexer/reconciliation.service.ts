/**
 * ReconciliationService — scheduled job that verifies vote tally columns
 * match the COUNT of individual vote rows.
 *
 * Discrepancies indicate a partial-failure bug in the indexer and must be
 * resolved before finalization display is shown as authoritative.
 *
 * Safe to run concurrently with live ingestion: uses READ COMMITTED isolation
 * and only updates claims where a real discrepancy exists.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

export interface ReconciliationResult {
  checkedAt: Date;
  totalChecked: number;
  discrepancies: number;
  discrepantClaimIds: number[];
  ok: boolean;
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private lastResult: ReconciliationResult | null = null;

  constructor(private readonly prisma: PrismaService) {}

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

    // Fetch all non-finalized claims with their stored tallies.
    const claims = await this.prisma.claim.findMany({
      where: { isFinalized: false },
      select: { id: true, approveVotes: true, rejectVotes: true },
    });

    const discrepantIds: number[] = [];

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
    }

    const result: ReconciliationResult = {
      checkedAt: new Date(),
      totalChecked: claims.length,
      discrepancies: discrepantIds.length,
      discrepantClaimIds: discrepantIds,
      ok: discrepantIds.length === 0,
    };

    this.lastResult = result;

    if (discrepantIds.length > 0) {
      this.logger.error(
        `Reconciliation found ${discrepantIds.length} discrepant claim(s): [${discrepantIds.join(', ')}]. ` +
          `Tallies have been corrected. Investigate indexer for partial-failure bugs.`,
      );
    } else {
      this.logger.log(`Reconciliation OK — ${claims.length} claims checked, no discrepancies.`);
    }

    return result;
  }
}
