import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

export interface RampReconciliationResult {
  checkedAt: Date;
  totalChecked: number;
  mismatches: number;
  mismatchedPurchaseIds: string[];
  ok: boolean;
}

@Injectable()
export class RampReconciliationService {
  private readonly logger = new Logger(RampReconciliationService.name);
  private lastResult: RampReconciliationResult | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  getLastResult(): RampReconciliationResult | null {
    return this.lastResult;
  }

  /**
   * Runs every 15 minutes. Queries recent ramp transactions from provider
   * and reconciles them against local records.
   */
  @Cron('0 */15 * * * *')
  async runReconciliation(): Promise<RampReconciliationResult> {
    this.logger.log('Starting ramp transaction reconciliation...');

    const rampApiKey = this.config.get<string>('RAMP_API_KEY');
    if (!rampApiKey) {
      this.logger.warn('RAMP_API_KEY not configured — skipping ramp reconciliation');
      const result: RampReconciliationResult = {
        checkedAt: new Date(),
        totalChecked: 0,
        mismatches: 0,
        mismatchedPurchaseIds: [],
        ok: true,
      };
      this.lastResult = result;
      return result;
    }

    const mismatchedIds: string[] = [];

    // Fetch recent local ramp transactions (last 24 hours)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const localTransactions = await this.prisma.rampTransaction.findMany({
      where: {
        lastSyncedAt: { gte: twentyFourHoursAgo },
      },
    });

    if (localTransactions.length === 0) {
      this.logger.log('No recent ramp transactions to reconcile');
      const result: RampReconciliationResult = {
        checkedAt: new Date(),
        totalChecked: 0,
        mismatches: 0,
        mismatchedPurchaseIds: [],
        ok: true,
      };
      this.lastResult = result;
      return result;
    }

    // Query provider for status of each purchase ID
    for (const localTx of localTransactions) {
      try {
        // This would call the actual Ramp provider API
        const providerStatus = await this.queryRampProviderStatus(localTx.purchaseId);

        if (providerStatus && providerStatus.status !== localTx.status) {
          this.logger.warn(
            `Ramp transaction mismatch for purchase ${localTx.purchaseId}: ` +
            `local=${localTx.status}, provider=${providerStatus.status}. Updating local record.`,
          );

          await this.prisma.rampTransaction.update({
            where: { purchaseId: localTx.purchaseId },
            data: {
              status: providerStatus.status,
              finalTxHash: providerStatus.finalTxHash || localTx.finalTxHash,
              lastSyncedAt: new Date(),
            },
          });

          mismatchedIds.push(localTx.purchaseId);
        }
      } catch (err) {
        this.logger.error(
          `Failed to reconcile ramp transaction ${localTx.purchaseId}: ${err}`,
        );
      }
    }

    const result: RampReconciliationResult = {
      checkedAt: new Date(),
      totalChecked: localTransactions.length,
      mismatches: mismatchedIds.length,
      mismatchedPurchaseIds: mismatchedIds,
      ok: mismatchedIds.length === 0,
    };

    this.lastResult = result;

    if (mismatchedIds.length > 0) {
      this.logger.warn(
        `Ramp reconciliation found ${mismatchedIds.length} mismatch(es): [${mismatchedIds.join(', ')}]. ` +
        `Investigate missed callbacks or out-of-order delivery.`,
      );
    } else {
      this.logger.log(`Ramp reconciliation OK — ${localTransactions.length} transactions checked.`);
    }

    return result;
  }

  private async queryRampProviderStatus(_purchaseId: string): Promise<{ status: string; finalTxHash?: string } | null> {
    // Placeholder for actual Ramp provider API call
    // In production, this would call the Ramp API with the purchaseId
    // to fetch the current transaction status
    return null;
  }
}
