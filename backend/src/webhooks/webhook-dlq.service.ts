import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { OutboundWebhookJob } from './outbound.types';

/** Injection token for the re-enqueue function — tests inject a fake queue. */
export const WEBHOOK_DLQ_ENQUEUE = 'WEBHOOK_DLQ_ENQUEUE';

export type DlqEnqueueFn = (job: OutboundWebhookJob) => Promise<void>;

const defaultEnqueue: DlqEnqueueFn = async (job) => {
  const { outboundWebhookQueue } = await import('./outbound.queue');
  await outboundWebhookQueue.add(job.eventType, job, { jobId: `${job.idempotencyKey}:dlq:${Date.now()}` });
};

/**
 * Dead-letter queue for outbound webhook deliveries whose retries are
 * exhausted (#1635). Ops can list entries and manually re-enqueue them.
 */
@Injectable()
export class WebhookDlqService {
  private readonly logger = new Logger(WebhookDlqService.name);
  private readonly alertThreshold = parseInt(process.env.WEBHOOK_DLQ_ALERT_THRESHOLD ?? '100', 10);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(WEBHOOK_DLQ_ENQUEUE) private readonly enqueue: DlqEnqueueFn = defaultEnqueue,
  ) {}

  /** Moves an exhausted delivery to the DLQ. Swallows persistence errors. */
  async add(job: OutboundWebhookJob, attempts: number, lastError?: string): Promise<void> {
    try {
      await this.prisma.webhookDlq.create({
        data: {
          targetUrl: job.targetUrl,
          eventType: job.eventType,
          idempotencyKey: job.idempotencyKey,
          payload: job.payload as Prisma.InputJsonValue,
          attempts,
          lastError: lastError ?? null,
        },
      });
      await this.checkThreshold();
    } catch (err) {
      this.logger.error(
        `[outbound-webhook] failed to persist DLQ entry: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Pending (not yet retried) DLQ entries, newest first. */
  list(limit = 100) {
    return this.prisma.webhookDlq.findMany({
      where: { retriedAt: null },
      orderBy: { failedAt: 'desc' },
      take: limit,
    });
  }

  /** Re-enqueues a DLQ entry for delivery and marks it retried. */
  async retry(id: string) {
    const entry = await this.prisma.webhookDlq.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException(`DLQ entry ${id} not found`);

    const subscription = await this.prisma.webhookSubscription.findFirst({
      where: { url: entry.targetUrl, active: true },
    });
    await this.enqueue({
      targetUrl: entry.targetUrl,
      eventType: entry.eventType,
      idempotencyKey: entry.idempotencyKey,
      payload: entry.payload as Record<string, unknown>,
      secret: subscription?.secret,
    });
    return this.prisma.webhookDlq.update({ where: { id }, data: { retriedAt: new Date() } });
  }

  private async checkThreshold(): Promise<void> {
    const size = await this.prisma.webhookDlq.count({ where: { retriedAt: null } });
    if (size > this.alertThreshold) {
      this.logger.error(
        `[outbound-webhook] ALERT: webhook DLQ size ${size} exceeds threshold ${this.alertThreshold}`,
      );
    }
  }
}
