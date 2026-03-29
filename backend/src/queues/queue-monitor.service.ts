import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import { getBullMQConnection } from '../redis/client';
import { MetricsService } from '../metrics/metrics.service';

// Max retries before a job lands in the failed (dead-letter) set
export const DLQ_MAX_ATTEMPTS = 5;

export const QUEUE_CONFIGS = [
  { name: 'indexer', label: 'indexer' },
  { name: 'notifications', label: 'notifications' },
  { name: 'claim-events', label: 'claim-events' },
  { name: 'reindex', label: 'reindex' },
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
      const q = new Queue(cfg.name, {
        connection: getBullMQConnection(),
        defaultJobOptions: {
          attempts: DLQ_MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      });
      this.queues.push(q);

      // Listen for failed events to record DLQ metrics with job type + reason
      q.on('failed' as any, (job: Job | undefined, err: Error) => {
        if (!job) return;
        const isExhausted = (job.attemptsMade ?? 0) >= DLQ_MAX_ATTEMPTS;
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
        }
      });
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
        const counts = await q.getJobCounts('failed');
        this.metrics.dlqDepth.set({ queue: q.name }, counts.failed ?? 0);
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
