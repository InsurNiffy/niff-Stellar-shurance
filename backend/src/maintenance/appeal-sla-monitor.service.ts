/**
 * Appeal SLA monitor — alerts when a claim sits in UNDER_APPEAL past its
 * on-chain appeal_deadline_ledger (+ grace), indicating a stuck keeper /
 * missed finalize_appeal call (#1348).
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../rpc/soroban.service';
import { MetricsService } from '../metrics/metrics.service';
import { getNetworkConfig } from '../config/network.config';

/** ~1 day of ledgers at 5 s/ledger — default grace after appeal_deadline. */
export const DEFAULT_APPEAL_SLA_GRACE_LEDGERS = 17_280;

const CLAIM_BATCH_SIZE = 50;

export interface StuckAppeal {
  claimId: number;
  appealDeadlineLedger: number;
  currentLedger: number;
  overdueByLedgers: number;
}

export interface AppealSlaCheckResult {
  checkedAt: Date;
  currentLedger: number;
  graceLedgers: number;
  underAppealChecked: number;
  stuck: StuckAppeal[];
  alertEmitted: boolean;
}

@Injectable()
export class AppealSlaMonitorService {
  private readonly logger = new Logger(AppealSlaMonitorService.name);
  private lastResult: AppealSlaCheckResult | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly soroban: SorobanService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  getLastResult(): AppealSlaCheckResult | null {
    return this.lastResult;
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async runScheduledCheck(): Promise<void> {
    const enabledRaw = this.config.get<string>('APPEAL_SLA_MONITOR_ENABLED', 'true');
    const enabled = enabledRaw === 'true' || enabledRaw === '1';
    if (!enabled) {
      this.logger.debug('Appeal SLA monitor disabled (APPEAL_SLA_MONITOR_ENABLED=false)');
      return;
    }

    try {
      await this.checkStuckAppeals();
    } catch (error) {
      this.logger.error(`Appeal SLA monitor failed: ${error}`);
      this.metrics?.recordAppealSlaCheckError();
    }
  }

  /** Public for tests and manual triggers. */
  async checkStuckAppeals(): Promise<AppealSlaCheckResult> {
    const graceLedgers = Number(
      this.config.get<string | number>(
        'APPEAL_SLA_GRACE_LEDGERS',
        DEFAULT_APPEAL_SLA_GRACE_LEDGERS,
      ),
    );

    const currentLedger = await this.soroban.getLatestLedger();

    const claims = await this.prisma.claim.findMany({
      where: { status: 'UNDER_APPEAL', deletedAt: null },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    const stuck: StuckAppeal[] = [];
    let checked = 0;

    const sourceAccount = getNetworkConfig().contractIds.niffyinsure;

    for (let i = 0; i < claims.length; i += CLAIM_BATCH_SIZE) {
      const batch = claims.slice(i, i + CLAIM_BATCH_SIZE);
      const ids = batch.map((c) => c.id);

      let onChainClaims: Array<Record<string, unknown> | null>;
      try {
        onChainClaims = await this.soroban.simulateGetClaimsBatch({
          ids,
          sourceAccount,
        });
      } catch (error) {
        this.logger.error(
          `Appeal SLA: failed to fetch on-chain batch [${ids[0]}-${ids[ids.length - 1]}]: ${error}`,
        );
        continue;
      }

      for (let j = 0; j < batch.length; j++) {
        const claimId = batch[j].id;
        const onChain = onChainClaims[j];
        if (!onChain) {
          this.logger.warn(`Appeal SLA: claim ${claimId} missing on-chain during UNDER_APPEAL`);
          continue;
        }

        const deadline = this.extractLedger(onChain, 'appeal_deadline_ledger');
        if (deadline == null) {
          this.logger.warn(`Appeal SLA: claim ${claimId} missing appeal_deadline_ledger`);
          continue;
        }

        checked++;
        const threshold = deadline + graceLedgers;
        if (currentLedger > threshold) {
          stuck.push({
            claimId,
            appealDeadlineLedger: deadline,
            currentLedger,
            overdueByLedgers: currentLedger - deadline,
          });
        }
      }
    }

    const result: AppealSlaCheckResult = {
      checkedAt: new Date(),
      currentLedger,
      graceLedgers,
      underAppealChecked: checked,
      stuck,
      alertEmitted: stuck.length > 0,
    };
    this.lastResult = result;

    this.metrics?.recordAppealSlaStuckCount(stuck.length);

    if (stuck.length > 0) {
      this.logger.error(
        JSON.stringify({
          event: 'appeal_sla_breach',
          severity: 'critical',
          message:
            'UNDER_APPEAL claims past appeal_deadline_ledger + grace — keeper finalize_appeal likely stuck',
          graceLedgers,
          currentLedger,
          stuckCount: stuck.length,
          stuck,
        }),
      );
      await this.sendWebhookAlert(result);
    } else {
      this.logger.log(
        JSON.stringify({
          event: 'appeal_sla_ok',
          underAppealChecked: checked,
          currentLedger,
          graceLedgers,
        }),
      );
    }

    return result;
  }

  private extractLedger(
    claimData: Record<string, unknown>,
    fieldName: string,
  ): number | null {
    const value = claimData[fieldName];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = parseInt(value, 10);
      return Number.isNaN(parsed) ? null : parsed;
    }
    // Soroban native decode sometimes nests u32 as { _: number } or similar.
    if (value && typeof value === 'object' && '_' in (value as object)) {
      const inner = (value as { _: unknown })._;
      if (typeof inner === 'number') return inner;
      if (typeof inner === 'string') {
        const parsed = parseInt(inner, 10);
        return Number.isNaN(parsed) ? null : parsed;
      }
    }
    return null;
  }

  private async sendWebhookAlert(result: AppealSlaCheckResult): Promise<void> {
    const url = this.config.get<string>('APPEAL_SLA_ALERT_WEBHOOK_URL', '')?.trim();
    if (!url) return;

    const secret = this.config.get<string>('APPEAL_SLA_ALERT_WEBHOOK_SECRET', '')?.trim();
    try {
      await axios.post(
        url,
        {
          event: 'appeal_sla_breach',
          checkedAt: result.checkedAt.toISOString(),
          currentLedger: result.currentLedger,
          graceLedgers: result.graceLedgers,
          stuckCount: result.stuck.length,
          stuck: result.stuck,
        },
        {
          timeout: 10_000,
          headers: {
            'Content-Type': 'application/json',
            ...(secret ? { 'X-Webhook-Secret': secret } : {}),
          },
        },
      );
    } catch (error) {
      this.logger.warn(`Appeal SLA webhook delivery failed: ${error}`);
    }
  }
}
