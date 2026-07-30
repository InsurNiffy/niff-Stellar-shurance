import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import { getBullMQConnection } from '../redis/client';
import { MetricsService } from '../metrics/metrics.service';
import { getQueueRetryConfig } from './queue-config';
import { QueueName } from './names';

// Fallback max-attempts for queues not in the canonical QueueName list.
// Exported for use in tests.
export const DLQ_MAX_ATTEMPTS = 5;
const FALLBACK_MAX_ATTEMPTS = DLQ_MAX_ATTEMPTS;

function resolveMaxAttempts(name: string): number {
  return getQueueRetryConfig(name as QueueName)?.maxAttempts ?? FALLBACK_MAX_ATTEMPTS;
}

function resolveBackoff(name: string): { type: 'exponential'; delay: number } {
  return getQueueRetryConfig(name as QueueName)?.backoff ?? { type: 'exponential', delay: 2_000 };
}

export const QUEUE_CONFIGS = [
  { name: 'indexer', label: 'indexer' },
  { name: 'notifications', label: 'notifications' },
  { name: 'claim-events', label: 'claim-events' },
  { name: 'reindex', label: 'reindex' },
  { name: 'backfill', label: 'backfill' },
  { name: 'tx-submit', label: 'tx-submit' },
  { name: 'claim-payouts', label: 'claim-payouts' },
  { name: 'policy-renewal-reminders', label: 'policy-renewal-reminders' },
  { name: 'webhooks', label: 'webhooks' },
  { name: 'outbound-webhooks', label: 'outbound-webhooks' },
] as const;

@Injectable()
export class QueueMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueMonitorService.name);
  private readonly queues: Queue[] = [];
  private readonly workers: Worker[] = [];
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(private readonly metrics: MetricsService) {}

  onModuleInit() {
    for (const cfg of QUEUE_CONFIGS) {
      const maxAttempts = resolveMaxAttempts(cfg.name);
      const backoff = resolveBackoff(cfg.name);
      const q = new Queue(cfg.name, {
        connection: getBullMQConnection(),
        defaultJobOptions: {
          attempts: maxAttempts,
          backoff,
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      });
      this.queues.push(q);

      // Use a Worker (autorun: false) solely for typed 'failed' event listening.
      // Queue does not expose a 'failed' event; Worker does.
      const w = new Worker(cfg.name, undefined, {
        connection: getBullMQConnection(),
        autorun: false,
      });
      w.on('failed', (job: Job | undefined, err: Error) => {
        if (!job) return;
        const attempts = job.attemptsMade ?? 0;
        const isExhausted = attempts >= maxAttempts;
        if (isExhausted) {
          const reason = err?.message?.slice(0, 120) ?? 'unknown';
          this.metrics.dlqJobFailed.inc({
            queue: cfg.name,
            job_name: job.name,
            failure_reason: reason,
          });
          this.logger.warn(
            `[DLQ] job ${job.id} (${job.name}) exhausted retries on queue "${cfg.name}": ${reason}`,
          );
        } else if (attempts > 0) {
          // Intermediate failure — job will be retried.
          this.metrics.recordJobRetry({ queue: cfg.name, jobName: job.name });
        }
        const duration = (Date.now() - (job.processedOn ?? job.timestamp ?? 0)) / 1000;
        this.metrics.recordJobProcessingDuration({
          queue: cfg.name,
          jobName: job.name,
          status: 'failed',
          durationMs: duration * 1000,
        });
      });
      w.on('completed', (job: Job) => {
        const duration = (Date.now() - (job.processedOn ?? job.timestamp ?? 0)) / 1000;
        this.metrics.recordJobProcessingDuration({
          queue: cfg.name,
          jobName: job.name,
          status: 'completed',
          durationMs: duration * 1000,
        });
      });
      this.workers.push(w);
    }

    // Poll DLQ depth every 30 s
    this.pollTimer = setInterval(() => void this.pollDepths(), 30_000);
    void this.pollDepths();
  }

  async onModuleDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    await Promise.all([
      ...this.queues.map((q) => q.close()),
      ...this.workers.map((w) => w.close()),
    ]);
  }

  private async pollDepths() {
    for (const q of this.queues) {
      try {
        const counts = await q.getJobCounts();
        this.metrics.dlqDepth.set({ queue: q.name }, counts.failed ?? 0);
        this.metrics.recordQueueDepth(q.name, counts.waiting ?? 0);
      } catch {
        // Redis may be unavailable — skip silently, alert will fire on stale gauge
      }
    }
  }

  /** Expose queues for Bull Board adapter registration */
  getQueues(): Queue[] {
    return this.queues;
  }

  /**
   * Replay a failed job by moving it back to waiting.
   * Returns the new job id.
   */
  async replayJob(queueName: string, jobId: string): Promise<string> {
    const q = this.queues.find((q) => q.name === queueName);
    if (!q) throw new Error(`Queue "${queueName}" not found`);
    const job = await q.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found in queue "${queueName}"`);
    await job.retry('failed');
    this.logger.log(`Replayed job ${jobId} on queue "${queueName}"`);
    return jobId;
  }
}
