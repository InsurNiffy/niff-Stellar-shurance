import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { outboundWebhookQueue } from './outbound.queue';

@Injectable()
export class OutboundWebhookService {
  private readonly logger = new Logger(OutboundWebhookService.name);

  constructor(private readonly config: ConfigService) {}

  getSubscriberUrls(envKey: string): string[] {
    const raw = this.config.get<string>(envKey, '');
    return raw.split(',').map((u) => u.trim()).filter(Boolean);
  }

  async enqueueForEvent(
    eventType: string,
    subscriberUrls: string[],
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<void> {
    for (const targetUrl of subscriberUrls) {
      await outboundWebhookQueue.add(eventType, {
        targetUrl,
        eventType,
        idempotencyKey: `${idempotencyKey}:${Buffer.from(targetUrl).toString('base64url').slice(0, 16)}`,
        payload,
      });
    }
  }

  async deliverClaimFiled(
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<void> {
    const urls = this.getSubscriberUrls('CLAIM_FILED_WEBHOOK_URLS');
    if (urls.length === 0) return;
    await this.enqueueForEvent('claim.filed', urls, payload, idempotencyKey);
    this.logger.log(`[outbound-webhook] enqueued claim.filed for ${urls.length} subscriber(s)`);
  }

  async deliverVoteCast(
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<void> {
    const urls = this.getSubscriberUrls('VOTE_CAST_WEBHOOK_URLS');
    if (urls.length === 0) return;
    await this.enqueueForEvent('vote.cast', urls, payload, idempotencyKey);
    this.logger.log(`[outbound-webhook] enqueued vote.cast for ${urls.length} subscriber(s)`);
  }

  async deliverTreasuryAlert(
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<void> {
    const urls = this.getSubscriberUrls('TREASURY_ALERT_WEBHOOK_URLS');
    if (urls.length === 0) return;
    await this.enqueueForEvent('treasury.balance_low', urls, payload, idempotencyKey);
    this.logger.log(
      `[outbound-webhook] enqueued treasury.balance_low for ${urls.length} subscriber(s)`,
    );
  }
}
