import { Injectable } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { getBullMQConnection } from '../redis/client';
import { TX_SUBMIT_QUEUE } from '../queues/names';
import { getQueueRetryConfig } from '../queues/queue-config';
import { QueueBackpressureException } from './queue-backpressure.exception';
import { MetricsService } from '../metrics/metrics.service';

export interface TxSubmitJobData {
  signed_xdr: string;
  idempotency_key?: string;
}

export interface TxJobStatus {
  jobId: string;
  status: 'queued' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';
  result?: {
    hash?: string;
    status?: string;
    ledger?: number;
    errorCode?: string;
    errorMessage?: string;
  };
  failedReason?: string;
}

@Injectable()
export class TxSubmitQueue {
  private readonly queue: Queue<TxSubmitJobData>;
  private readonly maxDepth: number;

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {
    const retryConfig = getQueueRetryConfig(TX_SUBMIT_QUEUE);
    this.queue = new Queue<TxSubmitJobData>(TX_SUBMIT_QUEUE, {
      connection: getBullMQConnection(),
      defaultJobOptions: {
        attempts: retryConfig.maxAttempts,
        backoff: retryConfig.backoff,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });
    this.maxDepth = this.config.get<number>('TX_SUBMIT_QUEUE_MAX_DEPTH', 1000);
  }

  async enqueue(data: TxSubmitJobData): Promise<string> {
    const counts = await this.queue.getJobCounts();
    const depth = (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);

    this.metrics.recordQueueDepth({ queue: TX_SUBMIT_QUEUE, depth });

    if (depth >= this.maxDepth) {
      throw new QueueBackpressureException({
        queueName: TX_SUBMIT_QUEUE,
        currentDepth: depth,
        maxDepth: this.maxDepth,
        retryAfterSeconds: 5,
      });
    }

    let jobId: string | undefined;
    if (data.idempotency_key) {
      jobId = `idem:${data.idempotency_key}`;
      const existingJob = await this.queue.getJob(jobId);
      if (existingJob) {
        return jobId;
      }
    }

    const job = await this.queue.add('submit', data, {
      ...(jobId && { jobId }),
    });
    return job.id!;
  }

  async getStatus(jobId: string): Promise<TxJobStatus> {
    const job: Job<TxSubmitJobData> | undefined = await this.queue.getJob(jobId);
    if (!job) {
      return { jobId, status: 'unknown' };
    }
    const state = await job.getState();
    const mapped = this.mapState(state);
    return {
      jobId,
      status: mapped,
      result: job.returnvalue ?? undefined,
      failedReason: job.failedReason ?? undefined,
    };
  }

  private mapState(state: string): TxJobStatus['status'] {
    const map: Record<string, TxJobStatus['status']> = {
      waiting: 'queued',
      active: 'active',
      completed: 'completed',
      failed: 'failed',
      delayed: 'delayed',
    };
    return map[state] ?? 'unknown';
  }
}
