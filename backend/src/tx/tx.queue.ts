/**
 * tx-submit queue — producer side.
 *
 * Enqueues signed XDR for async Soroban submission. The worker submits to
 * the RPC and writes lifecycle state to Redis.
 *
 * Retry policy: 3 attempts with exponential backoff starting at 2 s.
 * removeOnComplete: keep last 50 for debugging.
 * removeOnFail: keep last 200 for alerting / replay.
 */

import { Queue, JobsOptions } from "bullmq";
import { getBullMQConnection } from "../redis/client";

export const TX_SUBMIT_QUEUE = "tx-submit";

export interface TxSubmitJobData {
  /** Base64-encoded signed TransactionEnvelope XDR */
  signed_xdr: string;
  /** Optional idempotency key (UUID v4) */
  idempotency_key?: string;
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 200 },
};

let _queue: Queue<TxSubmitJobData> | null = null;

export function getTxSubmitQueue(): Queue<TxSubmitJobData> {
  if (!_queue) {
    _queue = new Queue<TxSubmitJobData>(TX_SUBMIT_QUEUE, {
      connection: getBullMQConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return _queue;
}

export async function enqueueTxSubmit(data: TxSubmitJobData): Promise<string> {
  const queue = getTxSubmitQueue();
  const job = await queue.add("tx:submit", data);
  return job.id ?? "";
}

export async function closeTxSubmitQueue(): Promise<void> {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
}
