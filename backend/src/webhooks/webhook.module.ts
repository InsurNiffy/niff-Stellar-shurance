import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { OutboundWebhookService } from './outbound-webhook.service';
import { WebhookController } from './webhook.controller';
import { WebhookRegistrationService } from './webhook-registration.service';
import { WEBHOOK_DELIVERY_QUEUE, WEBHOOK_DLQ } from './webhook.constants';

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue(
      { name: WEBHOOK_DELIVERY_QUEUE },
      { name: WEBHOOK_DLQ },
    ),
  ],
  controllers: [WebhookController],
  providers: [
    OutboundWebhookService,
    WebhookRegistrationService,
  ],
  exports: [OutboundWebhookService, WebhookRegistrationService],
})
export class WebhookModule {}
