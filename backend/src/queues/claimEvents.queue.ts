/**
 * claim-events queue — producer side.
 *
 * Enqueues Soroban contract events (ClaimFiled, VoteLogged, ClaimSettled)
 * for async processing by the worker. The worker writes to Postgres;
 * Redis is NOT the authoritative store.
 *
 * Retry / backoff policy
 * ──────────────────────
 *   attempts : 5   — retry up to 5 times before moving to failed set
 *   backoff  : exponential, starting at 1 s, capped at 30 s
 *   removeOnComplete : keep last 100 for debugging
 *   removeOnFail     : keep last 500 for alerting / replay
 *
 * Stalled job handling
 * ─────────────────────
 * BullMQ marks a job stalled if the worker does not call progress/complete
 * within `stalledInterval` (default 30 s). Stalled jobs are automatically
 * retried up to `maxStalledCount` times (default 1) then moved to failed.
 * Workers must complete jobs promptly or call `job.updateProgress()` to
 * reset the stall timer.
 */

import { Queue, JobsOptions } from "bullmq";
import { getBullMQConnection } from "../redis/client";

export interface ClaimEventJobData {
  /** Raw Soroban event type: "claim:filed" | "vote:logged" | "claim:settled" */
  eventType: string;
  /** Ledger sequence the event was emitted on */
  ledger: number;
  /** Serialised event payload (JSON string from Soroban RPC) */
  payload: string;
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
};

let _queue: Queue<ClaimEventJobData> | null = null;

export function getClaimEventsQueue(): Queue<ClaimEventJobData> {
  if (!_queue) {
    _queue = new Queue<ClaimEventJobData>("claim-events", {
      connection: getBullMQConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return _queue;
}

/**
 * Enqueue a Soroban contract event for processing.
 * Throws if Redis is unavailable (fail closed — we must not lose events).
 */
export async function enqueueClaimEvent(data: ClaimEventJobData): Promise<string> {
  const queue = getClaimEventsQueue();
  const job = await queue.add(`${data.eventType}:${data.ledger}`, data);
  return job.id ?? "";
}

/** Close the queue connection. Call on process shutdown. */
export async function closeClaimEventsQueue(): Promise<void> {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
}
