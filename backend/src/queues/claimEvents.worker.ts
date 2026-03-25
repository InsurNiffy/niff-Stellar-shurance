/**
 * claim-events worker — processes Soroban contract events and writes to DB.
 *
 * Stalled job handling
 * ─────────────────────
 * If this process crashes mid-job, BullMQ will redeliver the job after
 * `stalledInterval` ms. The processor must be idempotent: writing the same
 * event twice must not corrupt state (use INSERT … ON CONFLICT DO NOTHING
 * in Postgres, keyed on ledger + event_index).
 *
 * Concurrency
 * ───────────
 * `concurrency: 5` — process up to 5 jobs in parallel per worker instance.
 * Scale horizontally by running multiple worker processes; BullMQ handles
 * distributed locking via Redis.
 */

import { Worker, Job } from "bullmq";
import { getBullMQConnection } from "../redis/client";
import { ClaimEventJobData } from "./claimEvents.queue";

export type EventProcessor = (job: Job<ClaimEventJobData>) => Promise<void>;

/**
 * Default processor: logs the event. Replace with real DB write in production.
 *
 * IMPORTANT: This processor is intentionally minimal. The actual implementation
 * will call the Postgres repository layer once feat/db-schema lands.
 */
async function defaultProcessor(job: Job<ClaimEventJobData>): Promise<void> {
  const { eventType, ledger, payload } = job.data;
  console.info(
    `[claim-events worker] processing job ${job.id}: ${eventType} @ ledger ${ledger}`
  );
  // TODO(feat/db-schema): persist to admin_audit_log / claim_events table
  // await claimEventRepository.upsert({ eventType, ledger, payload });
  void payload; // suppress unused warning until DB layer lands
}

/**
 * Start the claim-events worker.
 * Returns the Worker instance so callers can await worker.close() on shutdown.
 */
export function startClaimEventsWorker(
  processor: EventProcessor = defaultProcessor
): Worker<ClaimEventJobData> {
  const worker = new Worker<ClaimEventJobData>(
    "claim-events",
    processor,
    {
      connection: getBullMQConnection(),
      concurrency: 5,
      // Stalled job settings — jobs not completed within 30 s are requeued
      stalledInterval: 30_000,
      maxStalledCount: 2,
    }
  );

  worker.on("completed", (job: Job<ClaimEventJobData>) => {
    console.info(`[claim-events worker] job ${job.id} completed`);
  });

  worker.on("failed", (job: Job<ClaimEventJobData> | undefined, err: Error) => {
    console.error(
      `[claim-events worker] job ${job?.id} failed (attempt ${job?.attemptsMade}):`,
      err.message
    );
  });

  worker.on("stalled", (jobId: string) => {
    console.warn(`[claim-events worker] job ${jobId} stalled — will be requeued`);
  });

  worker.on("error", (err: Error) => {
    console.error("[claim-events worker] worker error:", err.message);
  });

  return worker;
}
