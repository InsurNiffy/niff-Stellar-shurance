/**
 * Webhook job queue.
 *
 * This module provides a BullMQ-compatible interface backed by an in-memory
 * queue. When Redis becomes available, replace the `InMemoryQueue` class with
 * a real BullMQ `Queue` instance — the controller and tests are unchanged.
 *
 * BullMQ swap-in (production):
 * ─────────────────────────────
 *   import { Queue } from "bullmq";
 *   export const webhookQueue = new Queue("webhooks", {
 *     connection: { host: process.env.REDIS_HOST, port: 6379 },
 *     defaultJobOptions: {
 *       attempts: 5,
 *       backoff: { type: "exponential", delay: 1000 },
 *       removeOnComplete: true,
 *       removeOnFail: false,
 *     },
 *   });
 *
 * Retry semantics (documented)
 * ─────────────────────────────
 * - Max attempts: 5
 * - Backoff: exponential starting at 1 s (1s, 2s, 4s, 8s, 16s)
 * - Dead-letter: jobs that exhaust retries move to the "failed" set
 * - Observability: BullMQ exposes job counts via queue.getJobCounts()
 *   and integrates with Bull Board / Arena for a dashboard UI
 *
 * In-memory queue observability
 * ──────────────────────────────
 * GET /webhooks/queue/stats returns { pending, processed, failed } counts.
 */

import { WebhookJob } from "../types/webhook";

export interface QueueStats {
  pending: number;
  processed: number;
  failed: number;
}

type JobHandler = (job: WebhookJob) => Promise<void>;

class InMemoryQueue {
  private pending: WebhookJob[] = [];
  private _processed = 0;
  private _failed = 0;
  private handler: JobHandler | null = null;

  /** Enqueue a job. Returns immediately (non-blocking). */
  async add(name: string, data: WebhookJob): Promise<void> {
    this.pending.push(data);
    // Process asynchronously so the HTTP response is sent first
    Promise.resolve().then(() => this._process());
  }

  /** Register a job processor (mirrors BullMQ Worker pattern). */
  process(handler: JobHandler): void {
    this.handler = handler;
  }

  private async _process(): Promise<void> {
    const job = this.pending.shift();
    if (!job || !this.handler) return;
    try {
      await this.handler(job);
      this._processed++;
    } catch {
      this._failed++;
    }
  }

  stats(): QueueStats {
    return {
      pending: this.pending.length,
      processed: this._processed,
      failed: this._failed,
    };
  }

  /** Reset — used in tests only. */
  _reset(): void {
    this.pending = [];
    this._processed = 0;
    this._failed = 0;
  }
}

export const webhookQueue = new InMemoryQueue();

// Default no-op processor — replace with real business logic
webhookQueue.process(async (job) => {
  // TODO: dispatch job.eventType to domain handlers
  // e.g. if (job.provider === "stripe" && job.eventType === "payment_intent.succeeded") { ... }
  console.log(
    `[webhook-queue] processing provider=${job.provider} event=${job.eventType} key=${job.idempotencyKey}`
  );
});
