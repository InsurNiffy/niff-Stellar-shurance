/**
 * Vote Count Reconciliation Job
 *
 * Detects drift between indexed vote tallies (`approveVotes`, `rejectVotes`)
 * and on-chain `get_claim` results. Emits structured alerts when mismatches occur.
 *
 * Safe to run concurrently with live indexing — only reads from the contract
 * and does not modify claims. Alerts are logged for manual investigation.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../rpc/soroban.service';
import { MetricsService } from '../metrics/metrics.service';
import { getNetworkConfig } from '../config/network.config';

const CLAIM_BATCH_SIZE = 50;

export interface VoteReconciliationResult {
  checkedAt: Date;
  totalChecked: number;
  mismatches: number;
  mismatchedClaimIds: Array<{
    claimId: number;
    indexedApprove: number;
    indexedReject: number;
    onChainApprove: number;
    onChainReject: number;
  }>;
  ok: boolean;
}

@Injectable()
export class VoteReconciliationJob {
  private readonly logger = new Logger(VoteReconciliationJob.name);
  private lastResult: VoteReconciliationResult | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly soroban: SorobanService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  getLastResult(): VoteReconciliationResult | null {
    return this.lastResult;
  }

  /**
   * Reconcile vote counts between indexed DB and on-chain state.
   * Runs every 10 minutes. Safe to run concurrently with indexing.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcileVoteCounts(): Promise<void> {
    try {
      await this.runReconciliation();
    } catch (error) {
      this.logger.error(`Vote reconciliation failed: ${error}`);
      this.metrics?.recordVoteReconciliationError();
    }
  }

  private async runReconciliation(): Promise<VoteReconciliationResult> {
    this.logger.log('Starting vote count reconciliation with on-chain state...');

    // Fetch all non-finalized claims
    const claims = await this.prisma.claim.findMany({
      where: { isFinalized: false },
      select: { id: true, approveVotes: true, rejectVotes: true },
      orderBy: { id: 'asc' },
    });

    const mismatches: VoteReconciliationResult['mismatchedClaimIds'] = [];
    let processedCount = 0;

    // Process claims in batches
    for (let i = 0; i < claims.length; i += CLAIM_BATCH_SIZE) {
      const batch = claims.slice(i, i + CLAIM_BATCH_SIZE);
      const claimIds = batch.map((c) => c.id);

      try {
        // Fetch on-chain data for this batch using contract ID as source account
        const sourceAccount = getNetworkConfig().contractIds.niffyinsure;
        const onChainClaims = await this.soroban.simulateGetClaimsBatch({
          ids: claimIds,
          sourceAccount,
        });

        // Compare each claim's indexed vs on-chain tallies
        for (let j = 0; j < batch.length; j++) {
          const indexedClaim = batch[j];
          const onChainClaim = onChainClaims[j];

          if (!onChainClaim) {
            this.logger.warn(`Claim ${indexedClaim.id} not found on-chain (may be finalized)`);
            continue;
          }

          const onChainApprove = this.extractVoteCount(onChainClaim, 'approve_votes') ?? 0;
          const onChainReject = this.extractVoteCount(onChainClaim, 'reject_votes') ?? 0;

          // Check for mismatch
          if (indexedClaim.approveVotes !== onChainApprove || indexedClaim.rejectVotes !== onChainReject) {
            mismatches.push({
              claimId: indexedClaim.id,
              indexedApprove: indexedClaim.approveVotes,
              indexedReject: indexedClaim.rejectVotes,
              onChainApprove,
              onChainReject,
            });

            this.logger.warn(
              `Vote tally drift on claim ${indexedClaim.id}: ` +
                `indexed=(approve=${indexedClaim.approveVotes}, reject=${indexedClaim.rejectVotes}) ` +
                `onChain=(approve=${onChainApprove}, reject=${onChainReject})`
            );

            this.metrics?.recordVoteTallyMismatch(indexedClaim.id);
          }

          processedCount++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to reconcile batch [${claimIds[0]}-${claimIds[claimIds.length - 1]}]: ${error}`
        );
        // Continue with next batch rather than failing entirely
      }
    }

    const result: VoteReconciliationResult = {
      checkedAt: new Date(),
      totalChecked: processedCount,
      mismatches: mismatches.length,
      mismatchedClaimIds: mismatches,
      ok: mismatches.length === 0,
    };

    this.lastResult = result;

    if (mismatches.length > 0) {
      this.logger.error(
        `Vote reconciliation detected ${mismatches.length} tally mismatch(es). ` +
          `Details logged as individual warnings. Manual investigation required.`,
      );
      this.metrics?.recordVoteReconciliationMismatchCount(mismatches.length);
    } else {
      this.logger.log(`Vote reconciliation OK — ${processedCount} claims verified.`);
    }

    return result;
  }

  private extractVoteCount(claimData: Record<string, unknown>, fieldName: string): number | null {
    const value = claimData[fieldName];
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }
}
