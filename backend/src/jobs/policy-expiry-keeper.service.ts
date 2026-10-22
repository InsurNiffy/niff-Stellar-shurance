import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../rpc/soroban.service';
import { OutboundWebhookService } from '../webhooks/outbound-webhook.service';

const BATCH_SIZE = 10;
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 5 * 60_000;

/**
 * Keeper job: every 30s finds active policies past their expiry ledger and calls the
 * permissionless `process_expired_policies` entrypoint (max 10 per run). Emits a
 * `policy.expired` event / outbound webhook per policy. A circuit breaker pauses
 * the job after repeated RPC failures.
 */
@Injectable()
export class PolicyExpiryKeeperService {
  private readonly logger = new Logger(PolicyExpiryKeeperService.name);
  private consecutiveFailures = 0;
  private breakerOpenUntil = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly soroban: SorobanService,
    private readonly webhooks: OutboundWebhookService,
  ) {}

  @Cron('*/30 * * * * *')
  async run(): Promise<number> {
    if (Date.now() < this.breakerOpenUntil) {
      this.logger.warn('Circuit breaker open — skipping policy expiry cycle');
      return 0;
    }

    try {
      const currentLedger = await this.soroban.getLatestLedger();
      const expired = await this.prisma.policy.findMany({
        where: { isActive: true, deletedAt: null, endLedger: { lt: currentLedger } },
        orderBy: { endLedger: 'asc' },
        take: BATCH_SIZE,
        select: { id: true, policyId: true, holderAddress: true, endLedger: true },
      });
      if (expired.length === 0) return 0;

      const result = await this.soroban.processExpiredPolicies(BATCH_SIZE);
      this.consecutiveFailures = 0;

      for (const p of expired) {
        await this.prisma.policy.update({
          where: { id: p.id },
          data: { isActive: false },
        });
        this.logger.log(`policy.expired ${p.id} (endLedger=${p.endLedger}) tx=${result.txHash}`);
        await this.webhooks.deliverPolicyExpired(
          {
            policyId: p.policyId,
            holderAddress: p.holderAddress,
            expiryLedger: p.endLedger,
            txHash: result.txHash,
          },
          `policy.expired:${p.id}`,
        );
      }
      return expired.length;
    } catch (err) {
      this.consecutiveFailures += 1;
      this.logger.error(`Policy expiry cycle failed (${this.consecutiveFailures}): ${err}`);
      if (this.consecutiveFailures >= BREAKER_THRESHOLD) {
        this.breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
        this.consecutiveFailures = 0;
        this.logger.error('Circuit breaker opened for policy expiry keeper');
      }
      return 0;
    }
  }
}
