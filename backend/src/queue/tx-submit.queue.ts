import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import IORedis, { Redis } from 'ioredis';
import { SorobanRpc } from '@stellar/stellar-sdk';

export interface TxSubmitJobData {
  hash: string;
  signedXdr: string;
}

export interface TxSubmitQueueOptions {
  redisUrl?: string;
  maxDepth?: number;
  maxRetries?: number;
  rpcUrl?: string;
  /** Persists the latest status for a tx hash. */
  updateTxRow?: (hash: string, status: TxStatus, detail?: string) => Promise<void>;
}

export type TxStatus = 'queued' | 'submitted' | 'confirmed' | 'failed' | 'dlq';

export class QueueFullError extends Error {
  readonly statusCode = 429;
  constructor(depth: number, maxDepth: number) {
    super(`Tx submission queue is full (depth ${depth} > max ${maxDepth})`);
    this.name = 'QueueFullError';
  }
}

const QUEUE_NAME = 'tx-submit';
const DLQ_NAME = 'tx-submit-dlq';
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30_000;

/**
 * TxSubmitQueue wraps a BullMQ queue + worker that signs-and-submits
 * pre-signed XDRs to Soroban RPC, polls for confirmation, and applies
 * backpressure based on queue depth.
 */
export class TxSubmitQueue {
  private readonly queue: Queue<TxSubmitJobData>;
  private readonly dlq: Queue<TxSubmitJobData>;
  private readonly worker: Worker<TxSubmitJobData>;
  private readonly queueEvents: QueueEvents;
  private readonly connection: Redis;
  private readonly maxDepth: number;
  private readonly maxRetries: number;
  private readonly server: SorobanRpc.Server;
  private readonly updateTxRow?: TxSubmitQueueOptions['updateTxRow'];

  constructor(opts: TxSubmitQueueOptions = {}) {
    const redisUrl = opts.redisUrl ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
    this.maxDepth = opts.maxDepth ?? Number(process.env.TX_QUEUE_MAX_DEPTH ?? 100);
    this.maxRetries = opts.maxRetries ?? Number(process.env.TX_QUEUE_MAX_RETRIES ?? 5);
    this.updateTxRow = opts.updateTxRow;

    const rpcUrl = opts.rpcUrl ?? process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
    this.server = new SorobanRpc.Server(rpcUrl);

    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

    this.queue = new Queue<TxSubmitJobData>(QUEUE_NAME, { connection: this.connection });
    this.dlq = new Queue<TxSubmitJobData>(DLQ_NAME, { connection: this.connection });
    this.queueEvents = new QueueEvents(QUEUE_NAME, { connection: this.connection });

    this.worker = new Worker<TxSubmitJobData>(
      QUEUE_NAME,
      async (job) => this.process(job),
      {
        connection: this.connection,
        concurrency: Number(process.env.TX_QUEUE_CONCURRENCY ?? 4),
      },
    );

    this.worker.on('failed', async (job, err) => {
      if (!job) return;
      const attempts = job.attemptsMade;
      if (attempts >= this.maxRetries) {
        await this.dlq.add('dead-letter', job.data, { removeOnComplete: false });
        await this.safeUpdate(job.data.hash, 'dlq', err?.message);
      }
    });
  }

  /** Returns current queue depth (waiting + active + delayed). */
  async depth(): Promise<number> {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'delayed', 'paused');
    return (
      (counts.waiting ?? 0) +
      (counts.active ?? 0) +
      (counts.delayed ?? 0) +
      (counts.paused ?? 0)
    );
  }

  /**
   * Enqueue a signed XDR for submission. Throws QueueFullError (429) when
   * the queue depth exceeds TX_QUEUE_MAX_DEPTH.
   */
  async enqueue(hash: string, signedXdr: string): Promise<string> {
    const currentDepth = await this.depth();
    if (currentDepth > this.maxDepth) {
      throw new QueueFullError(currentDepth, this.maxDepth);
    }

    await this.safeUpdate(hash, 'queued');

    const job = await this.queue.add(
      'submit',
      { hash, signedXdr },
      {
        jobId: hash,
        attempts: this.maxRetries,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: false,
      },
    );

    return job.id ?? hash;
  }

  /** Returns the current status for a tx hash, or null if unknown. */
  async status(hash: string): Promise<TxStatus | null> {
    const job = await this.queue.getJob(hash);
    if (!job) {
      const dead = await this.dlq.getJob(hash);
      if (dead) return 'dlq';
      return null;
    }
    const state = await job.getState();
    switch (state) {
      case 'completed':
        return 'confirmed';
      case 'failed':
        return 'failed';
      case 'active':
        return 'submitted';
      default:
        return 'queued';
    }
  }

  private async process(job: Job<TxSubmitJobData>): Promise<void> {
    const { hash, signedXdr } = job.data;

    const sendResponse = await this.server.sendTransaction(signedXdr);
    if (sendResponse.status === 'ERROR') {
      throw new Error(`sendTransaction failed: ${JSON.stringify(sendResponse.errorResult ?? sendResponse)}`);
    }

    await this.safeUpdate(hash, 'submitted');

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const tx = await this.server.getTransaction(hash);
      if (tx.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        await this.safeUpdate(hash, 'confirmed');
        return;
      }
      if (tx.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`Transaction ${hash} failed on-chain`);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    throw new Error(`Timed out waiting for confirmation of ${hash}`);
  }

  private async safeUpdate(hash: string, status: TxStatus, detail?: string): Promise<void> {
    if (!this.updateTxRow) return;
    try {
      await this.updateTxRow(hash, status, detail);
    } catch {
      // Persistence failures must not break queue processing.
    }
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queueEvents.close();
    await this.queue.close();
    await this.dlq.close();
    await this.connection.quit();
  }
}
