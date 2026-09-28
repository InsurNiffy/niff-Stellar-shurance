import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { WebhookSubscriptionsController } from './webhook-subscriptions.controller';
import { WebhookSubscriptionsService, WEBHOOK_DNS_LOOKUP } from './webhook-subscriptions.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { OutboundWebhookService } from './outbound-webhook.service';
import { defaultDnsLookup } from './ssrf';
import { setOutboundJobProcessor } from './outbound.queue';

/**
 * Outbound webhook subscriptions, HMAC signing and delivery logging (#1484).
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [WebhookSubscriptionsController],
  providers: [
    WebhookSubscriptionsService,
    WebhookDeliveryService,
    OutboundWebhookService,
    { provide: WEBHOOK_DNS_LOOKUP, useValue: defaultDnsLookup },
  ],
  exports: [WebhookSubscriptionsService, WebhookDeliveryService, OutboundWebhookService],
})
export class WebhooksModule implements OnModuleInit {
  constructor(private readonly delivery: WebhookDeliveryService) {}

  /** Route queue jobs through the signing + delivery-log implementation. */
  onModuleInit() {
    setOutboundJobProcessor(async (job) => {
      await this.delivery.deliver(job);
    });
  }
}
