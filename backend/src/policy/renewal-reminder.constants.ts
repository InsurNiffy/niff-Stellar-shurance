/**
 * Renewal reminder configuration constants.
 *
 * LEAD TIME WINDOWS
 * ──────────────────────────────────────────────────────────────────────────────
 * Two reminder windows are fired per policy, in decreasing urgency order:
 *
 *   REMINDER_7D  — sent when endLedger - currentLedger <= 120,960 ledgers
 *                  (≈ 7 days at 5 s/ledger: 7 × 86,400 / 5 = 120,960)
 *                  Matches RENEWAL_OPEN_LEDGERS_BEFORE_EXPIRY — the earliest
 *                  point the policy holder can act on a renewal.
 *
 *   REMINDER_1D  — sent when endLedger - currentLedger <= 17,280 ledgers
 *                  (≈ 1 day at 5 s/ledger: 86,400 / 5 = 17,280)
 *                  Final nudge; window still open but urgency is high.
 *
 * IDEMPOTENCY KEY
 * ──────────────────────────────────────────────────────────────────────────────
 * BullMQ job IDs are set to `renewal-reminder:{policyId}:{reminderType}`.
 * BullMQ rejects duplicate job IDs when the previous job is still in the
 * waiting / active / delayed set, which prevents the scanner from enqueuing
 * the same reminder twice. Jobs that complete or fail are removed per
 * removeOnComplete / removeOnFail settings so the same reminder CAN be
 * re-enqueued in the next scan cycle if the earlier attempt failed.
 *
 * TIME BUDGET (staging dataset: up to 50,000 active policies)
 * ──────────────────────────────────────────────────────────────────────────────
 * The scanner paginates in batches of SCAN_PAGE_SIZE (default 500).
 * Each page issues one Prisma query (indexed on endLedger + isActive + deletedAt).
 * At 50,000 policies with a 60-day expiry window, the scanner processes at most
 * ~8,333 policies per run (assuming uniform expiry distribution).
 * Estimated wall-clock time: < 5 seconds per scan on a 2-vCPU staging instance.
 * The @Cron schedule runs hourly; the isRunning guard prevents overlap.
 */

import { RENEWAL_OPEN_LEDGERS_BEFORE_EXPIRY } from "./renewal.constants";
import { getQueueRetryConfig } from "../queues/queue-config";

export const REMINDER_QUEUE_NAME = "policy-renewal-reminders";

export type ReminderType = "7d" | "1d";

/**
 * Reminder windows: each entry defines the ledger distance from expiry at which
 * the reminder becomes eligible, and the human-readable type label used for
 * deduplication and logging.
 *
 * Listed in DESCENDING order of lead time so the scanner checks the longer
 * window first. A policy close to expiry may qualify for both windows; both
 * jobs are enqueued independently.
 */
export const REMINDER_WINDOWS: { type: ReminderType; ledgersBeforeExpiry: number }[] = [
  {
    type: "7d",
    // Same as renewal open window — earliest actionable moment
    ledgersBeforeExpiry: RENEWAL_OPEN_LEDGERS_BEFORE_EXPIRY, // 120,960
  },
  {
    type: "1d",
    // 1 day = 86,400 s / 5 s/ledger = 17,280 ledgers
    ledgersBeforeExpiry: 17_280,
  },
];

/** Rows fetched per Prisma page during the scan. Bounded to prevent OOM. */
export const SCAN_PAGE_SIZE = 500;

/** BullMQ job options for reminder delivery jobs. */
export const REMINDER_JOB_OPTIONS = (() => {
  const cfg = getQueueRetryConfig("policy-renewal-reminders");
  return {
    attempts: cfg.maxAttempts,
    backoff: cfg.backoff,
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  };
})();
