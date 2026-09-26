/**
 * AppealWindowReminderService — scheduled scan for REJECTED claims whose
 * appeal open window is about to close.
 *
 * Algorithm:
 *   1. Read current ledger from ledgerCursor.
 *   2. Find REJECTED claims with appealsCount = 0 whose
 *      appealOpenDeadlineLedger is in (currentLedger, currentLedger + leadLedgers].
 *   3. Persist an in-app notification for the claimant (notifications model).
 *   4. Deduplicate via Redis/DB: skip if an unacknowledged notification of this
 *      type already exists for (userId, claimId) — checked via a deterministic
 *      look-up on recent notifications.
 *
 * Lead window is configurable via APPEAL_WINDOW_REMINDER_LEDGERS (default 1 day).
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  APPEAL_OPEN_WINDOW_LEDGERS,
  APPEAL_WINDOW_NOTIFICATION_TTL_SECONDS,
  APPEAL_WINDOW_NOTIFICATION_TYPE,
  APPEAL_WINDOW_SCAN_PAGE_SIZE,
  DEFAULT_APPEAL_WINDOW_REMINDER_CRON,
  DEFAULT_APPEAL_WINDOW_REMINDER_LEDGERS,
} from './appeal-window-reminder.constants';

@Injectable()
export class AppealWindowReminderService {
  private readonly logger = new Logger(AppealWindowReminderService.name);
  private isRunning = false;
  private readonly network: string;
  private readonly leadLedgers: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {
    this.network = this.config.get<string>('STELLAR_NETWORK', 'testnet');
    this.leadLedgers = Number(
      process.env.APPEAL_WINDOW_REMINDER_LEDGERS ??
        this.config.get<number>(
          'APPEAL_WINDOW_REMINDER_LEDGERS',
          DEFAULT_APPEAL_WINDOW_REMINDER_LEDGERS,
        ),
    );
  }

  @Cron(process.env.APPEAL_WINDOW_REMINDER_CRON ?? DEFAULT_APPEAL_WINDOW_REMINDER_CRON)
  async runScan(): Promise<void> {
    if (process.env.DISABLE_APPEAL_WINDOW_REMINDER === 'true') {
      return;
    }

    if (this.isRunning) {
      this.logger.warn('Appeal window reminder scan already running — skipping tick');
      return;
    }

    this.isRunning = true;
    const startedAt = Date.now();

    try {
      const currentLedger = await this.getCurrentLedger();
      if (!currentLedger) {
        this.logger.warn('No ledger cursor — skipping appeal window reminder scan');
        return;
      }

      const lowerBound = currentLedger + 1;
      const upperBound = currentLedger + this.leadLedgers;

      let cursor: number | undefined;
      let scanned = 0;
      let notified = 0;
      let skippedDedup = 0;

      while (true) {
        const page = await this.prisma.claim.findMany({
          where: {
            status: 'REJECTED',
            appealsCount: 0,
            deletedAt: null,
            OR: [
              {
                appealOpenDeadlineLedger: {
                  gte: lowerBound,
                  lte: upperBound,
                },
              },
              // Fallback for rows not yet backfilled: derive deadline from rejection ledger.
              {
                appealOpenDeadlineLedger: null,
                updatedAtLedger: {
                  gte: lowerBound - APPEAL_OPEN_WINDOW_LEDGERS,
                  lte: upperBound - APPEAL_OPEN_WINDOW_LEDGERS,
                },
              },
            ],
            ...(cursor != null ? { id: { gt: cursor } } : {}),
          },
          orderBy: { id: 'asc' },
          take: APPEAL_WINDOW_SCAN_PAGE_SIZE,
          select: {
            id: true,
            creatorAddress: true,
            appealOpenDeadlineLedger: true,
            updatedAtLedger: true,
          },
        });

        if (page.length === 0) break;

        for (const claim of page) {
          scanned++;
          cursor = claim.id;

          const deadline =
            claim.appealOpenDeadlineLedger ??
            claim.updatedAtLedger + APPEAL_OPEN_WINDOW_LEDGERS;

          const alreadySent = await this.hasPendingReminder(
            claim.creatorAddress,
            claim.id,
          );
          if (alreadySent) {
            skippedDedup++;
            continue;
          }

          const ledgersRemaining = deadline - currentLedger;

          await this.notifications.createNotificationRecord({
            userId: claim.creatorAddress,
            type: APPEAL_WINDOW_NOTIFICATION_TYPE,
            payload: {
              claimId: claim.id,
              appealOpenDeadlineLedger: deadline,
              ledgersRemaining,
              message: `Your appeal window for claim ${claim.id} closes soon. Submit an appeal before ledger ${deadline}.`,
            },
            ttlSeconds: APPEAL_WINDOW_NOTIFICATION_TTL_SECONDS,
          });
          notified++;
        }

        if (page.length < APPEAL_WINDOW_SCAN_PAGE_SIZE) break;
      }

      this.logger.log(
        `Appeal window reminder scan complete in ${Date.now() - startedAt}ms ` +
          `currentLedger=${currentLedger} lead=${this.leadLedgers} ` +
          `scanned=${scanned} notified=${notified} skipped_dedup=${skippedDedup}`,
      );
    } catch (err) {
      this.logger.error(`Appeal window reminder scan failed: ${err}`);
    } finally {
      this.isRunning = false;
    }
  }

  private async hasPendingReminder(
    userId: string,
    claimId: number,
  ): Promise<boolean> {
    const existing = await this.prisma.notification.findFirst({
      where: {
        userId,
        type: APPEAL_WINDOW_NOTIFICATION_TYPE,
        acknowledgedAt: null,
        payload: {
          path: ['claimId'],
          equals: claimId,
        },
      },
      select: { id: true },
    });
    return !!existing;
  }

  private async getCurrentLedger(): Promise<number | null> {
    const cursor = await this.prisma.ledgerCursor.findUnique({
      where: { network: this.network },
    });
    return cursor?.lastProcessedLedger ?? null;
  }
}
