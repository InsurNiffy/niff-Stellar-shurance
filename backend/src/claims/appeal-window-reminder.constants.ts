/**
 * Appeal window reminder configuration.
 *
 * On-chain APPEAL_OPEN_WINDOW_LEDGERS = 3 days (51_840 ledgers at 5 s/ledger).
 * Reminder fires when appeal_open_deadline_ledger is within the configured lead window.
 */

/** Matches contracts/niffyinsure/src/ledger.rs APPEAL_OPEN_WINDOW_LEDGERS. */
export const APPEAL_OPEN_WINDOW_LEDGERS = 51_840;

/**
 * Default lead time before appeal_open_deadline_ledger to notify the claimant.
 * 1 day = 86_400 s / 5 s/ledger = 17_280 ledgers.
 * Override with APPEAL_WINDOW_REMINDER_LEDGERS.
 */
export const DEFAULT_APPEAL_WINDOW_REMINDER_LEDGERS = 17_280;

/** Rows fetched per Prisma page during the scan. */
export const APPEAL_WINDOW_SCAN_PAGE_SIZE = 200;

/** Default cron when APPEAL_WINDOW_REMINDER_CRON is unset (every 15 minutes). */
export const DEFAULT_APPEAL_WINDOW_REMINDER_CRON = '0 */15 * * * *';

/** In-app notification type persisted on the notifications model. */
export const APPEAL_WINDOW_NOTIFICATION_TYPE = 'appeal_window_closing';

/** TTL for appeal-window notification records (7 days). */
export const APPEAL_WINDOW_NOTIFICATION_TTL_SECONDS = 7 * 24 * 60 * 60;
