import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../rpc/soroban.service';

const BATCH_SIZE = 50;

export interface PolicyReconciliationResult {
  checkedAt: Date;
  totalChecked: number;
  corrected: number;
  correctedPolicyIds: string[];
  ok: boolean;
}

@Injectable()
export class PolicyIsActiveReconciliationService {
  private readonly logger = new Logger(PolicyIsActiveReconciliationService.name);
  private lastResult: PolicyReconciliationResult | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly soroban?: SorobanService,
  ) {}

  getLastResult(): PolicyReconciliationResult | null {
    return this.lastResult;
  }

  /** Runs every 10 minutes. Queries policies with potentially stale isActive flags
   *  and reconciles them against on-chain get_policy simulation results. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async runReconciliation(): Promise<PolicyReconciliationResult> {
    this.logger.log('Starting policy isActive reconciliation...');

    if (!this.soroban) {
      this.logger.warn('SorobanService not available — skipping policy reconciliation');
      const result: PolicyReconciliationResult = {
        checkedAt: new Date(),
        totalChecked: 0,
        corrected: 0,
        correctedPolicyIds: [],
        ok: true,
      };
      this.lastResult = result;
      return result;
    }

    const policies = await this.prisma.policy.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        holderAddress: true,
        policyId: true,
        isActive: true,
      },
    });

    const correctedIds: string[] = [];

    for (let i = 0; i < policies.length; i += BATCH_SIZE) {
      const batch = policies.slice(i, i + BATCH_SIZE);

      let onChainResults: (Record<string, unknown> | null)[];
      try {
        onChainResults = await this.soroban.simulateGetPoliciesBatch({
          keys: batch.map((p) => ({ holder: p.holderAddress, policy_id: p.policyId })),
        });
      } catch (err) {
        this.logger.warn(
          `simulateGetPoliciesBatch failed for batch ${i}–${i + batch.length}: ${err}. Skipping batch.`,
        );
        continue;
      }

      for (let j = 0; j < batch.length; j++) {
        const policy = batch[j];
        const onChain = onChainResults[j];

        // On-chain null means the policy does not exist or has expired in contract storage.
        const onChainActive = onChain !== null && Boolean(onChain['is_active'] ?? onChain['active']);

        if (policy.isActive !== onChainActive) {
          this.logger.warn(
            `isActive mismatch for policy ${policy.id}: DB=${policy.isActive}, on-chain=${onChainActive}. Correcting.`,
          );

          await this.prisma.policy.update({
            where: { id: policy.id },
            data: { isActive: onChainActive, updatedAt: new Date() },
          });

          correctedIds.push(policy.id);
        }
      }
    }

    const result: PolicyReconciliationResult = {
      checkedAt: new Date(),
      totalChecked: policies.length,
      corrected: correctedIds.length,
      correctedPolicyIds: correctedIds,
      ok: correctedIds.length === 0,
    };

    this.lastResult = result;

    if (correctedIds.length > 0) {
      this.logger.warn(
        `Policy isActive reconciliation corrected ${correctedIds.length} policy(ies): [${correctedIds.join(', ')}]. ` +
          `Investigate indexer for missed PolicyExpired/PolicyInitiated events.`,
      );
    } else {
      this.logger.log(`Policy isActive reconciliation OK — ${policies.length} policies checked.`);
    }

    return result;
  }
}
