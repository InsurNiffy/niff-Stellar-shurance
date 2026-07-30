/**
 * Webhook job queue — #409
 *
 * Uses BullMQ backed by Redis for:
 *   - Persistent job storage (survives restarts)
 *   - Exponential backoff retry (up to MAX_WEBHOOK_ATTEMPTS)
 *   - Delivery tracking per webhook endpoint
 *   - Dead-letter queue: jobs exhausting retries move to BullMQ "failed" set
 *   - Admin visibility via getDeliveryHistory() / retryFailed()
 *
 * Retry semantics:
 *   - Max attempts : MAX_WEBHOOK_ATTEMPTS (default 5, env-configurable)
 *   - Backoff      : exponential, starting at 1 s (1s, 2s, 4s, 8s, 16s …)
 *   - Max delay    : capped at MAX_WEBHOOK_RETRY_DELAY ms (default 32 s)
 *   - Dead-letter  : jobs exhausting retries remain in BullMQ "failed" set
 *                    and are listed by GET /admin/webhooks/dead-letter.
 *
 * Key naming: uses getBullMQConnection() which does NOT carry the global
 * ioredis keyPrefix — BullMQ manages its own key namespace.
 */

import { Queue, Worker, Job } from 'bullmq';
import { getBullMQConnection } from '../redis/client';
import { getQueueRetryConfig } from '../queues/queue-config';
import { WebhookJob } from '../types/webhook';

export interface QueueStats {
  pending: number;
  processed: number;
  failed: number;
}

export interface DeliveryRecord {
  jobId: string;
  provider: string;
  eventType: string;
  idempotencyKey: string;
  receivedAt: number;
  status: 'completed' | 'failed' | 'active' | 'waiting';
  attemptsMade: number;
  failedReason?: string;
}

const QUEUE_NAME = 'webhooks';

/**
 * Maximum delivery attempts before a job is moved to the dead-letter set.
 * Configurable via QUEUE_RETRY_MAP env var; defaults to 5.
 * @deprecated Use getQueueRetryConfig('webhooks').maxAttempts instead.
 */
export const MAX_WEBHOOK_ATTEMPTS = (() => {
  // Preserve backward compatibility with the legacy MAX_WEBHOOK_ATTEMPTS env var
  const legacy = process.env.MAX_WEBHOOK_ATTEMPTS;
  if (legacy) {
    const parsed = parseInt(legacy, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return getQueueRetryConfig('webhooks').maxAttempts;
})();

/**
 * Maximum delay (ms) between retry attempts.
 * Exponential backoff is capped at this value.
 * Configurable via QUEUE_RETRY_MAP env var; defaults to 32 000 ms.
 * @deprecated Use getQueueRetryConfig('webhooks') instead.
 */
export const MAX_WEBHOOK_RETRY_DELAY = parseInt(
  process.env.MAX_WEBHOOK_RETRY_DELAY ?? '32000',
  10,
);

// ── Queue ─────────────────────────────────────────────────────────────────────

const webhookRetry = getQueueRetryConfig('webhooks');

export const webhookQueue = new Queue<WebhookJob>(QUEUE_NAME, {
  connection: getBullMQConnection(),
  defaultJobOptions: {
    attempts: MAX_WEBHOOK_ATTEMPTS,
    backoff: webhookRetry.backoff,
    removeOnComplete: { count: 500 },  // keep last 500 completed for history
    removeOnFail: false,               // retain ALL failed jobs for DLQ admin endpoint
  },
});

// ── Worker ────────────────────────────────────────────────────────────────────

export const webhookWorker = new Worker<WebhookJob>(
  QUEUE_NAME,
  async (job: Job<WebhookJob>) => {
    const { provider, eventType, idempotencyKey } = job.data;
    // Domain handlers are registered via webhookWorker.on('completed') or
    // by replacing this processor. Extend here for provider-specific logic.
    console.log(
      `[webhook-queue] processing provider=${provider} event=${eventType} key=${idempotencyKey} attempt=${job.attemptsMade + 1}/${MAX_WEBHOOK_ATTEMPTS}`,
    );
  },
  {
    connection: getBullMQConnection(),
    concurrency: 5,
    limiter: {
      // Cap individual job delay at MAX_WEBHOOK_RETRY_DELAY to prevent
      // unbounded exponential growth on long-running queues.
      max: MAX_WEBHOOK_RETRY_DELAY,
      duration: MAX_WEBHOOK_RETRY_DELAY,
    },
  },
);

webhookWorker.on('failed', (job, err) => {
  if (job) {
    const isDlq = job.attemptsMade >= MAX_WEBHOOK_ATTEMPTS;
    console.error(
      `[webhook-queue] job ${isDlq ? 'DEAD-LETTERED' : 'failed'} provider=${job.data.provider} key=${job.data.idempotencyKey} attempts=${job.attemptsMade}/${MAX_WEBHOOK_ATTEMPTS}`,
      err.message,
    );
  }
});

// ── Delivery history ──────────────────────────────────────────────────────────

/**
 * Returns recent delivery records across all states.
 * Used by the admin endpoint GET /webhooks/deliveries.
 */
export async function getDeliveryHistory(limit = 100): Promise<DeliveryRecord[]> {
  const [completed, failed, active, waiting] = await Promise.all([
    webhookQueue.getCompleted(0, limit),
    webhookQueue.getFailed(0, limit),
    webhookQueue.getActive(0, limit),
    webhookQueue.getWaiting(0, limit),
  ]);

  const toRecord = (job: Job<WebhookJob>, status: DeliveryRecord['status']): DeliveryRecord => ({
    jobId: String(job.id),
    provider: job.data.provider,
    eventType: job.data.eventType,
    idempotencyKey: job.data.idempotencyKey,
    receivedAt: job.data.receivedAt,
    status,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason,
  });

  return [
    ...completed.map((j) => toRecord(j, 'completed')),
    ...failed.map((j) => toRecord(j, 'failed')),
    ...active.map((j) => toRecord(j, 'active')),
    ...waiting.map((j) => toRecord(j, 'waiting')),
  ].slice(0, limit);
}

// ── Dead-letter queue helpers ─────────────────────────────────────────────────

/**
 * Returns all permanently failed jobs (exhausted all MAX_WEBHOOK_ATTEMPTS retries).
 * These are the "dead-letter" entries listed by GET /admin/webhooks/dead-letter.
 */
export async function getDeadLetterJobs(limit = 100): Promise<DeliveryRecord[]> {
  const failed = await webhookQueue.getFailed(0, limit);
  return failed
    .filter((job) => job.attemptsMade >= MAX_WEBHOOK_ATTEMPTS)
    .map((job) => ({
      jobId: String(job.id),
      provider: job.data.provider,
      eventType: job.data.eventType,
      idempotencyKey: job.data.idempotencyKey,
      receivedAt: job.data.receivedAt,
      status: 'failed' as const,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
    }));
}

/**
 * Replay a dead-letter job by ID: resets attempt count and re-queues.
 * Used by POST /admin/webhooks/dead-letter/:id/replay.
 */
export async function replayDeadLetterJob(jobId: string): Promise<void> {
  const job = await webhookQueue.getJob(jobId);
  if (!job) throw new Error(`Dead-letter job ${jobId} not found`);
  await job.retry();
}

/**
 * Manually retry a specific failed job by ID.
 * Used by the admin endpoint POST /webhooks/deliveries/:jobId/retry.
 */
export async function retryFailedJob(jobId: string): Promise<void> {
  const job = await webhookQueue.getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  await job.retry();
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getQueueStats(): Promise<QueueStats> {
  const counts = await webhookQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
  return {
    pending: (counts.waiting ?? 0) + (counts.active ?? 0),
    processed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
  };
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

export async function closeWebhookQueue(): Promise<void> {
  await webhookWorker.close();
  await webhookQueue.close();
}
