import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { outboundWebhookQueue } from './outbound.queue';

export interface WebhookRegistration {
  url: string;
  eventTypes: string[];
}

@Injectable()
export class OutboundWebhookService {
  private readonly logger = new Logger(OutboundWebhookService.name);
  private readonly registrations = new Map<string, WebhookRegistration>();

  constructor(private readonly config: ConfigService) {}

  getSubscriberUrls(envKey: string): string[] {
    const raw = this.config.get<string>(envKey, '');
    return raw.split(',').map((u) => u.trim()).filter(Boolean);
  }

  signPayload(payload: Record<string, unknown>): string {
    const secret = this.config.get<string>('WEBHOOK_SECRET', '');
    const body = JSON.stringify(payload);
    return createHmac('sha256', secret).update(body).digest('hex');
  }

  registerWebhook(registration: WebhookRegistration): WebhookRegistration {
    const key = registration.url.trim();
    if (this.registrations.has(key)) {
      throw new Error(`Webhook already registered for url: ${key}`);
    }
    const stored: WebhookRegistration = {
      url: key,
      eventTypes: [...registration.eventTypes],
    };
    this.registrations.set(key, stored);
    this.logger.log(`[outbound-webhook] registered ${key} for ${stored.eventTypes.join(',')}`);
    return stored;
  }

  async enqueueForEvent(
    eventType: string,
    subscriberUrls: string[],
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<void> {
    const signature = this.signPayload(payload);
    for (const targetUrl of subscriberUrls) {
      await outboundWebhookQueue.add(
        eventType,
        {
          targetUrl,
          eventType,
          idempotencyKey: `${idempotencyKey}:${Buffer.from(targetUrl).toString('base64url').slice(0, 16)}`,
          payload,
          signature,
        },
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
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

  async deliverPolicyExpired(
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<void> {
    const urls = this.getSubscriberUrls('POLICY_EXPIRED_WEBHOOK_URLS');
    if (urls.length === 0) return;
    await this.enqueueForEvent('policy.expired', urls, payload, idempotencyKey);
    this.logger.log(`[outbound-webhook] enqueued policy.expired for ${urls.length} subscriber(s)`);
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
