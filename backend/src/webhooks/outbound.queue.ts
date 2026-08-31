/**
 * Outbound webhook delivery queue — issues #891, #892, #893.
 *
 * Subscribers (comma-separated URLs from env) receive POST requests with event
 * payloads. Jobs are retried with exponential backoff up to MAX_OUTBOUND_ATTEMPTS.
 */

import { Queue, Worker, Job } from 'bullmq';
import { getBullMQConnection } from '../redis/client';
import { getQueueRetryConfig } from '../queues/queue-config';

export interface OutboundWebhookJob {
  targetUrl: string;
  eventType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

const QUEUE_NAME = 'outbound-webhooks';

/**
 * Maximum delivery attempts for outbound webhook jobs.
 * Configurable via QUEUE_RETRY_MAP env var; defaults to 5.
 * @deprecated Use getQueueRetryConfig('outbound-webhooks').maxAttempts instead.
 */
export const MAX_OUTBOUND_ATTEMPTS = (() => {
  // Preserve backward compatibility with the legacy MAX_OUTBOUND_WEBHOOK_ATTEMPTS env var
  const legacy = process.env.MAX_OUTBOUND_WEBHOOK_ATTEMPTS;
  if (legacy) {
    const parsed = parseInt(legacy, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return getQueueRetryConfig('outbound-webhooks').maxAttempts;
})();

export const MAX_OUTBOUND_WEBHOOK_SIZE_BYTES = parseInt(
  process.env.MAX_OUTBOUND_WEBHOOK_SIZE_BYTES ?? '1048576',
  10,
);

const outboundRetry = getQueueRetryConfig('outbound-webhooks');

export const outboundWebhookQueue = new Queue<OutboundWebhookJob>(QUEUE_NAME, {
  connection: getBullMQConnection(),
  defaultJobOptions: {
    attempts: MAX_OUTBOUND_ATTEMPTS,
    backoff: outboundRetry.backoff,
    removeOnComplete: { count: 200 },
    removeOnFail: false,
  },
});

function getPayloadSizeBytes(payload: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(payload), 'utf8');
}

export const outboundWebhookWorker = new Worker<OutboundWebhookJob>(
  QUEUE_NAME,
  async (job: Job<OutboundWebhookJob>) => {
    const { targetUrl, eventType, payload, idempotencyKey } = job.data;
    const payloadSize = getPayloadSizeBytes(payload);

    if (payloadSize > MAX_OUTBOUND_WEBHOOK_SIZE_BYTES) {
      console.warn(
        `[outbound-webhook] payload size exceeded: event=${eventType} to=${targetUrl} size=${payloadSize} max=${MAX_OUTBOUND_WEBHOOK_SIZE_BYTES} key=${idempotencyKey}`,
      );
      throw new Error(
        `Webhook payload size (${payloadSize} bytes) exceeds limit (${MAX_OUTBOUND_WEBHOOK_SIZE_BYTES} bytes)`,
      );
    }

    const { default: axios } = await import('axios');
    await axios.post(targetUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Event-Type': eventType,
        'X-Idempotency-Key': idempotencyKey,
      },
      timeout: 10_000,
    });
    console.log(
      `[outbound-webhook] delivered event=${eventType} to=${targetUrl} key=${idempotencyKey}`,
    );
  },
  {
    connection: getBullMQConnection(),
    concurrency: 5,
  },
);

outboundWebhookWorker.on('failed', (job, err) => {
  if (job) {
    console.error(
      `[outbound-webhook] failed event=${job.data.eventType} to=${job.data.targetUrl} attempt=${job.attemptsMade}/${MAX_OUTBOUND_ATTEMPTS}: ${err.message}`,
    );
  }
});
