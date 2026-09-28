/**
 * NotificationDispatchService — preference-aware event router (#1483).
 *
 * Responsibilities:
 *  1. Per-event × channel routing (email / inApp) from user preferences.
 *  2. Quiet-hours deferral: emails queued with a delay until the window ends.
 *  3. Digest batching for claim updates (configurable mode/window).
 *  4. Email sending only when the address is verified.
 *  5. Queue payloads contain IDs only — PII (email address, template context)
 *     is loaded inside the worker by ID.
 */
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  NOTIFICATION_PREFERENCES_REPOSITORY,
  NotificationPreferencesRepository,
} from './notification-preferences.repository';
import {
  NotificationChannel,
  NotificationRoutingPreferences,
  NotificationType,
  NOTIFICATION_TYPE_TO_PREFERENCE_KEY,
  resolveRoutingPreferences,
} from './notification-preference.types';
import { isWithinQuietHours, nextQuietPeriodEnd } from './quiet-hours';
import { getNotificationQueue } from './notification-jobs.queue';
import {
  NOTIFICATION_JOB_OPTIONS,
  getPriorityForNotificationType,
} from './notification-queue.constants';

/** Queue payload — IDs only, no PII. */
export interface NotificationDeliveryJob {
  userId: string;
  notificationType: NotificationType;
  /** Notification row IDs to deliver (worker loads details by ID). */
  recordIds: string[];
  channels: NotificationChannel[];
}

export type NotificationEnqueueFn = (
  job: NotificationDeliveryJob,
  delayMs?: number,
) => Promise<string>;

export const NOTIFICATION_ENQUEUE = 'NOTIFICATION_ENQUEUE';

/** Domain event handed to the dispatcher. All fields are IDs or scalars. */
export interface DomainNotificationEvent {
  type: NotificationType;
  userId: string;
  /** Business record ID (claim id / policy id). */
  recordId: string;
  /** Scalar, non-personal context (ids, outcome, timestamps, ledger refs). */
  context?: Record<string, string | number | null | undefined>;
}

export type DispatchSkipReason =
  | 'preference_disabled'
  | 'no_enabled_channel'
  | 'email_unverified'
  | 'email_not_routed';

export interface DispatchOutcome {
  userId: string;
  type: NotificationType;
  /** Created in-app notification row (null when no channel was served). */
  notificationId: string | null;
  /** Channels acted on for this event. */
  channels: NotificationChannel[];
  skipped: Array<{ channel: NotificationChannel; reason: DispatchSkipReason }>;
  /** ISO timestamp until which the email is deferred (quiet hours). */
  deferredUntil?: string;
  /** True when the email was buffered into a digest batch. */
  digested: boolean;
}

interface DigestEntry {
  notificationType: NotificationType;
  recordIds: string[];
}

const defaultEnqueue: NotificationEnqueueFn = async (job, delayMs) => {
  const queue = getNotificationQueue();
  const added = await queue.add(`notification:${job.notificationType}`, job, {
    ...NOTIFICATION_JOB_OPTIONS,
    priority: getPriorityForNotificationType(job.notificationType),
    ...(delayMs && delayMs > 0 ? { delay: delayMs } : {}),
  });
  return added.id ?? 'unknown';
};

@Injectable()
export class NotificationDispatchService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationDispatchService.name);
  private readonly enqueue: NotificationEnqueueFn;
  private readonly digestWindowMs: number;
  /** userId → pending record IDs for digest batching. */
  private readonly digests = new Map<string, DigestEntry>();
  private digestTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATION_PREFERENCES_REPOSITORY)
    private readonly preferencesRepository: NotificationPreferencesRepository,
    private readonly configService: ConfigService,
    @Optional() @Inject(NOTIFICATION_ENQUEUE)
    enqueue?: NotificationEnqueueFn,
  ) {
    this.enqueue = enqueue ?? defaultEnqueue;
    this.digestWindowMs = Number(
      this.configService.get('NOTIFICATION_DIGEST_WINDOW_MS', 60_000),
    );
  }

  onModuleDestroy(): void {
    if (this.digestTimer) clearTimeout(this.digestTimer);
    this.digestTimer = null;
  }

  /** Routes a domain event to the enabled channels for that user. */
  async dispatch(event: DomainNotificationEvent): Promise<DispatchOutcome> {
    const record = await this.preferencesRepository.findByUserId(event.userId);
    const routing = resolveRoutingPreferences(record?.routing);

    const preferenceKey = NOTIFICATION_TYPE_TO_PREFERENCE_KEY[event.type];
    const masterSwitch =
      (record?.[preferenceKey] ?? null) !== false; // default: enabled

    const outcome: DispatchOutcome = {
      userId: event.userId,
      type: event.type,
      notificationId: null,
      channels: [],
      skipped: [],
      digested: false,
    };

    if (!masterSwitch) {
      outcome.skipped.push(
        { channel: 'email', reason: 'preference_disabled' },
        { channel: 'inApp', reason: 'preference_disabled' },
      );
      return outcome;
    }

    const eventRouting = routing.events[event.type];
    const emailRouted = eventRouting.email;
    const inAppRouted = eventRouting.inApp;

    const emailReady =
      emailRouted && Boolean(record?.email) && record?.emailVerified === true;
    if (emailRouted && !emailReady) {
      outcome.skipped.push({ channel: 'email', reason: 'email_unverified' });
    }

    if (!emailRouted && !inAppRouted) {
      outcome.skipped.push({ channel: 'email', reason: 'no_enabled_channel' });
      outcome.skipped.push({ channel: 'inApp', reason: 'no_enabled_channel' });
      return outcome;
    }

    // Create the notification row (the worker renders email from it by ID).
    const payload: Record<string, unknown> = {
      type: event.type,
      recordId: event.recordId,
      ...(event.context ?? {}),
    };
    const rowId = await this.prisma.notification.create({
      data: {
        userId: event.userId,
        type: event.type,
        payload: payload as import('@prisma/client').Prisma.InputJsonValue,
        // When in-app is not routed the row exists only as the email's
        // rendering source → mark it read so it never shows as unread.
        ...(inAppRouted ? {} : { acknowledgedAt: new Date() }),
      },
    });
    outcome.notificationId = rowId.id;
    if (inAppRouted) outcome.channels.push('inApp');

    if (!emailReady) return outcome;

    const quiet = this.resolveQuietDelay(routing, new Date());
    const digestThisEvent =
      routing.digestMode !== 'off' && event.type === 'claim_update';

    if (digestThisEvent) {
      this.bufferDigest(event.userId, event.type, rowId.id);
      outcome.digested = true;
      outcome.channels.push('email');
      if (quiet.deferredUntil) outcome.deferredUntil = quiet.deferredUntil;
      return outcome;
    }

    const jobId = await this.enqueue(
      {
        userId: event.userId,
        notificationType: event.type,
        recordIds: [rowId.id],
        channels: ['email'],
      },
      quiet.delayMs,
    );
    this.logger.debug(
      `enqueued ${event.type} email job=${jobId} user=${event.userId} delay=${quiet.delayMs}ms`,
    );
    outcome.channels.push('email');
    if (quiet.deferredUntil) outcome.deferredUntil = quiet.deferredUntil;
    return outcome;
  }

  /**
   * Flushes pending digest batches (per user). Called by the digest timer
   * and directly by tests. Returns the number of enqueued jobs.
   */
  async flushDigests(userId?: string): Promise<number> {
    const pending = userId
      ? [[userId, this.digests.get(userId)] as const].filter(
          (entry): entry is readonly [string, DigestEntry] => Boolean(entry[1]),
        )
      : Array.from(this.digests.entries());

    let enqueued = 0;
    for (const [uid, entry] of pending) {
      this.digests.delete(uid);
      if (entry.recordIds.length === 0) continue;

      const record = await this.preferencesRepository.findByUserId(uid);
      const routing = resolveRoutingPreferences(record?.routing);
      const quiet = this.resolveQuietDelay(routing, new Date());

      await this.enqueue(
        {
          userId: uid,
          notificationType: entry.notificationType,
          recordIds: [...entry.recordIds],
          channels: ['email'],
        },
        quiet.delayMs,
      );
      enqueued += 1;
    }
    return enqueued;
  }

  /** Exposed for tests: currently buffered digest entries. */
  peekDigests(): Record<string, string[]> {
    return Object.fromEntries(
      Array.from(this.digests.entries()).map(([uid, entry]) => [
        uid,
        [...entry.recordIds],
      ]),
    );
  }

  private bufferDigest(
    userId: string,
    notificationType: NotificationType,
    recordId: string,
  ): void {
    const entry = this.digests.get(userId);
    if (entry) entry.recordIds.push(recordId);
    else this.digests.set(userId, { notificationType, recordIds: [recordId] });

    if (!this.digestTimer) {
      this.digestTimer = setTimeout(() => {
        this.digestTimer = null;
        void this.flushDigests().catch((err) =>
          this.logger.error(`digest flush failed: ${String(err)}`),
        );
      }, this.digestWindowMs);
      // Do not keep the process alive just for a digest timer.
      (this.digestTimer as { unref?: () => void }).unref?.();
    }
  }

  /** Quiet-hours delay in ms plus the ISO moment delivery resumes. */
  private resolveQuietDelay(
    routing: NotificationRoutingPreferences,
    now: Date,
  ): { delayMs: number; deferredUntil?: string } {
    const { quietHours } = routing;
    if (!quietHours.enabled) return { delayMs: 0 };
    if (!isWithinQuietHours(now, quietHours)) return { delayMs: 0 };
    const resumeAt = nextQuietPeriodEnd(now, quietHours);
    return {
      delayMs: Math.max(resumeAt.getTime() - now.getTime(), 0),
      deferredUntil: resumeAt.toISOString(),
    };
  }
}
