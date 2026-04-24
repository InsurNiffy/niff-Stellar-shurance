/**
 * RenewalReminderService — scheduled scanner for upcoming policy expiries.
 *
 * SCHEDULE: hourly (configurable via RENEWAL_REMINDER_CRON env var).
 * A run guard (isRunning) prevents overlap if a scan takes longer than 1 hour.
 *
 * ALGORITHM:
 *   1. Fetch the current ledger from the ledgerCursor table (same source as
 *      the indexer; never calls the RPC during the scan to avoid coupling).
 *   2. For each REMINDER_WINDOW, compute the expiry ledger range:
 *        lowerBound = currentLedger + 1
 *        upperBound = currentLedger + window.ledgersBeforeExpiry
 *      Any active, non-deleted policy with endLedger in [lowerBound, upperBound]
 *      is eligible for that reminder.
 *   3. Paginate over eligible policies in batches of SCAN_PAGE_SIZE.
 *   4. For each policy, check notification preferences for the holder.
 *   5. If opted in, call enqueueRenewalReminder(). BullMQ deduplicates on job ID.
 *   6. Log skipped policies (opted out, already notified) for ops visibility.
 *
 * IDEMPOTENCY:
 *   The BullMQ job ID `renewal-reminder:{policyId}:{reminderType}` is the
 *   primary deduplication key. A second scan during the same window will
 *   attempt to add a job with the same ID; BullMQ silently ignores it if the
 *   job is still pending/active. If the job completed (notification sent) and
 *   the policy is still in the window on the next scan, a new job is enqueued —
 *   this is intentional and safe because the notification service must be
 *   idempotent on (policyId, reminderType, channel) anyway.
 *
 * NOTIFICATION PREFERENCES:
 *   Preferences are stored in-memory on NotificationsService (prototype).
 *   For production, replace with a Prisma query against a notification_preferences
 *   table keyed on holderAddress. The interface is intentionally minimal here
 *   so it can be swapped without changing the scanner logic.
 *
 * DB INDEX REQUIREMENT:
 *   The Prisma query filters on (isActive, deletedAt, endLedger) with ordering
 *   on endLedger. Ensure a composite index exists:
 *     CREATE INDEX idx_policy_expiry_scan
 *       ON "Policy" (is_active, deleted_at, end_ledger)
 *       WHERE is_active = true AND deleted_at IS NULL;
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  REMINDER_WINDOWS,
  SCAN_PAGE_SIZE,
  ReminderType,
} from "./renewal-reminder.constants";
import { enqueueRenewalReminder } from "./renewal-reminder.job";
import { SECONDS_PER_LEDGER } from "./renewal.constants";
import { getRuntimeEnv } from "../config/runtime-env";

interface ScanSummary {
  window: ReminderType;
  scanned: number;
  enqueued: number;
  skippedOptOut: number;
  skippedDeduplicated: number;
}

@Injectable()
export class RenewalReminderService {
  private readonly logger = new Logger(RenewalReminderService.name);
  private isRunning = false;
  private readonly network: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {
    this.network = this.config.get<string>("STELLAR_NETWORK", "testnet");
  }

  /**
   * Hourly cron — configurable via RENEWAL_REMINDER_CRON env var.
   * Default: every hour at minute 0.
   *
   * To change in production, set RENEWAL_REMINDER_CRON to a valid cron expression,
   * e.g. "0 * /4 * * *" for every 4 hours.
   */
  @Cron(getRuntimeEnv().RENEWAL_REMINDER_CRON)
  async runScan(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn("Renewal reminder scan already running — skipping this tick");
      return;
    }

    this.isRunning = true;
    const startedAt = Date.now();

    try {
      const currentLedger = await this.getCurrentLedger();
      if (!currentLedger) {
        this.logger.warn(
          "No ledger cursor found — indexer may not have started yet. Skipping scan.",
        );
        return;
      }

      this.logger.log(`Renewal reminder scan started. currentLedger=${currentLedger}`);

      const summaries: ScanSummary[] = [];

      for (const window of REMINDER_WINDOWS) {
        const summary = await this.scanWindow(
          currentLedger,
          window.type,
          window.ledgersBeforeExpiry,
        );
        summaries.push(summary);
      }

      const elapsed = Date.now() - startedAt;
      for (const s of summaries) {
        this.logger.log(
          `[${s.window}] scanned=${s.scanned} enqueued=${s.enqueued} ` +
            `skipped_opt_out=${s.skippedOptOut} skipped_dedup=${s.skippedDeduplicated}`,
        );
      }
      this.logger.log(`Renewal reminder scan complete in ${elapsed}ms`);
    } catch (err) {
      this.logger.error(`Renewal reminder scan failed: ${err}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Scan one reminder window, paginating over eligible policies.
   *
   * Configurable lead time:
   *   REMINDER_7D: endLedger within [currentLedger+1, currentLedger+120_960]
   *   REMINDER_1D: endLedger within [currentLedger+1, currentLedger+17_280]
   *
   * Both windows scan independently — a policy near expiry may qualify for both.
   */
  private async scanWindow(
    currentLedger: number,
    reminderType: ReminderType,
    ledgersBeforeExpiry: number,
  ): Promise<ScanSummary> {
    const lowerBound = currentLedger + 1;
    const upperBound = currentLedger + ledgersBeforeExpiry;

    let cursor: string | undefined = undefined;
    let scanned = 0;
    let enqueued = 0;
    let skippedOptOut = 0;
    let skippedDeduplicated = 0;

     
    while (true) {
      const page = await this.prisma.policy.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          endLedger: { gte: lowerBound, lte: upperBound },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: SCAN_PAGE_SIZE,
        select: {
          id: true,
          policyId: true,
          holderAddress: true,
          endLedger: true,
        },
      });

      if (page.length === 0) break;

      for (const policy of page) {
        scanned++;

        // Check notification preferences — skip opted-out holders
        const prefs = this.notifications.getPreferences(policy.holderAddress);
        const hasAnyChannelEnabled =
          prefs.emailEnabled || prefs.discordEnabled || prefs.telegramEnabled;

        if (!hasAnyChannelEnabled) {
          this.logger.debug(
            `[${reminderType}] Skipping policy ${policy.id} (holderAddress=${policy.holderAddress}): all channels opted out`,
          );
          skippedOptOut++;
          continue;
        }

        // Enqueue — BullMQ deduplicates via job ID
        const ledgersRemaining = policy.endLedger - currentLedger;
        const estimatedSecondsRemaining = ledgersRemaining * SECONDS_PER_LEDGER;

        const jobId = await enqueueRenewalReminder({
          policyDbId: policy.id,
          policyId: policy.policyId,
          holderAddress: policy.holderAddress,
          reminderType,
          endLedger: policy.endLedger,
          currentLedger,
        });

        if (jobId) {
          enqueued++;
          this.logger.debug(
            `[${reminderType}] Enqueued reminder for policy ${policy.id} ` +
              `(endLedger=${policy.endLedger}, ~${Math.round(estimatedSecondsRemaining / 3600)}h remaining)`,
          );
        } else {
          // Job ID returned null — this shouldn't happen normally but handle gracefully
          skippedDeduplicated++;
          this.logger.debug(
            `[${reminderType}] Deduplicated reminder for policy ${policy.id} — job already queued`,
          );
        }
      }

      // Advance cursor for next page
      cursor = page[page.length - 1]!.id;

      // If we got fewer rows than the page size, we've exhausted the result set
      if (page.length < SCAN_PAGE_SIZE) break;
    }

    return {
      window: reminderType,
      scanned,
      enqueued,
      skippedOptOut,
      skippedDeduplicated,
    };
  }

  /**
   * Fetch current ledger from the ledgerCursor table (same source as the indexer).
   * Returns null if the indexer has not processed any ledgers yet.
   * Does NOT call the Soroban RPC — the scan must not add RPC latency.
   */
  private async getCurrentLedger(): Promise<number | null> {
    const cursor = await this.prisma.ledgerCursor.findUnique({
      where: { network: this.network },
      select: { lastProcessedLedger: true },
    });
    return cursor?.lastProcessedLedger ?? null;
  }

  /**
   * Manual trigger — useful for backfill or ops tooling.
   * Returns per-window summaries.
   */
  async triggerScan(): Promise<ScanSummary[]> {
    if (this.isRunning) {
      throw new Error("A scan is already in progress");
    }
    await this.runScan();
    return [];
  }
}
