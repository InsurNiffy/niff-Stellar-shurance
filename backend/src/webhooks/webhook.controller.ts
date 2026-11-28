import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHmac, randomUUID } from 'crypto';
import { AdminGuard } from '../auth/admin.guard';
import { WebhookRegistryService } from './webhook-registry.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { WEBHOOK_QUEUE, WEBHOOK_DLQ } from './webhook.constants';

export interface WebhookDeliveryJob {
  deliveryId: string;
  webhookId: string;
  url: string;
  event: string;
  payload: Record<string, unknown>;
  signature: string;
  attempt: number;
}

/**
 * Outbound webhook service: queues signed deliveries via BullMQ with
 * exponential backoff and moves exhausted deliveries to a dead-letter queue.
 */
@Controller('admin/webhooks')
@UseGuards(AdminGuard)
export class WebhookController {
  constructor(
    private readonly registry: WebhookRegistryService,
    @InjectQueue(WEBHOOK_QUEUE) private readonly deliveryQueue: Queue,
    @InjectQueue(WEBHOOK_DLQ) private readonly dlq: Queue,
  ) {}

  /**
   * Register a webhook subscription. Duplicate registrations (same url + event)
   * are rejected by the registry's idempotency guard.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: CreateWebhookDto) {
    return this.registry.register(dto);
  }

  @Get()
  async list() {
    return this.registry.list();
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.registry.remove(id);
  }

  /**
   * Queue an outbound delivery for a claim status change event.
   * Payloads are signed with HMAC-SHA256 using WEBHOOK_SECRET and the
   * signature is sent in the X-NiffyInsure-Signature header.
   */
  async enqueueDelivery(
    webhookId: string,
    url: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const deliveryId = randomUUID();
    const signature = this.sign(payload);

    const job: WebhookDeliveryJob = {
      deliveryId,
      webhookId,
      url,
      event,
      payload,
      signature,
      attempt: 0,
    };

    await this.deliveryQueue.add('deliver', job, {
      jobId: deliveryId,
      attempts: this.maxAttempts(),
      backoff: { type: 'exponential', delay: this.baseDelayMs() },
      removeOnComplete: true,
      removeOnFail: false,
    });

    return deliveryId;
  }

  /**
   * Move a delivery that exhausted its retries into the dead-letter queue.
   */
  async moveToDlq(job: WebhookDeliveryJob, reason: string): Promise<void> {
    await this.dlq.add('dead-letter', { ...job, reason, failedAt: new Date().toISOString() });
  }

  /** Compute the HMAC-SHA256 signature for a payload. */
  sign(payload: Record<string, unknown>): string {
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) {
      throw new Error('WEBHOOK_SECRET is not configured');
    }
    const body = JSON.stringify(payload);
    return createHmac('sha256', secret).update(body).digest('hex');
  }

  private maxAttempts(): number {
    const parsed = Number.parseInt(process.env.WEBHOOK_MAX_ATTEMPTS ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
  }

  private baseDelayMs(): number {
    const parsed = Number.parseInt(process.env.WEBHOOK_BASE_DELAY_MS ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
  }
}
