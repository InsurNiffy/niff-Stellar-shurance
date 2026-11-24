/**
 * NotificationsService — idempotent claim-finalized notifications.
 *
 * Channels: email (Mailhog-compatible SMTP), Discord webhook, Telegram Bot API.
 * Credentials stored in env vars / secrets management — never in source.
 * PII minimisation: only claim_id, policy_id, outcome in templates.
 * Default: email opt-in, Discord/Telegram opt-out.
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as nodemailer from 'nodemailer';
import type {
  ClaimFinalizedEvent,
  NotificationRecord,
  UserPreferences,
} from './notification.types';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_TO_PREFERENCE_KEY,
  NotificationPreferenceRecord,
  NotificationPreferences,
  NotificationPreferenceUpdate,
  NotificationRoutingPreferences,
  NotificationType,
  resolveRoutingPreferences,
} from './notification-preference.types';
import {
  NOTIFICATION_PREFERENCES_REPOSITORY,
  NotificationPreferencesRepository,
} from './notification-preferences.repository';
import {
  buildClaimFinalizedEmail,
  buildClaimFinalizedDiscord,
  buildClaimFinalizedTelegram,
  PolicyExpiryEmailTemplate,
  PolicyExpiryPushTemplate,
  PolicyExpiryContext,
} from './notification.templates';

/**
 * A queued notification job. Enqueued idempotently on the
 * `(userId, type, refId)` dedup key and delivered by the BullMQ workers
 * (email / push channels) wired in NotificationsModule.
 */
export interface NotificationJob {
  userId: string;
  type: NotificationType;
  refId: string;
  channel: 'email' | 'push';
  payload?: Record<string, unknown>;
}

/** A persisted, unacknowledged notification record for the authenticated user. */
export interface NotificationInboxRecord {
  id: string;
  userId: string;
  type: NotificationType;
  refId: string;
  channel: 'email' | 'push';
  payload: Record<string, unknown> | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  // In-memory stores — replace with Prisma in production
  private readonly sentSet = new Set<string>();
  private readonly prefs = new Map<string, UserPreferences>();
  // Idempotent enqueue dedup keys: `${userId}:${type}:${refId}`
  private readonly enqueuedSet = new Set<string>();
  // Persisted inbox records keyed by id
  private readonly inbox = new Map<string, NotificationInboxRecord>();

  private transport: nodemailer.Transporter | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Inject(NOTIFICATION_PREFERENCES_REPOSITORY)
    private readonly preferencesRepository: NotificationPreferencesRepository,
    private readonly prisma: PrismaService,
  ) {}

  private getTransport(): nodemailer.Transporter {
    if (this.transport) return this.transport;
    this.transport = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST', 'localhost'),
      port: this.configService.get<number>('SMTP_PORT', 1025),
      secure: this.configService.get<number>('SMTP_PORT', 1025) === 465,
      auth:
        this.configService.get('SMTP_USER') && this.configService.get('SMTP_PASS')
          ? {
              user: this.configService.get<string>('SMTP_USER'),
              pass: this.configService.get<string>('SMTP_PASS'),
            }
          : undefined,
    });
    return this.transport;
  }

  getPreferences(claimantPublicKey: string): UserPreferences {
    return (
      this.prefs.get(claimantPublicKey) ?? {
        claimantPublicKey,
        emailEnabled: true,
        discordEnabled: false,
        telegramEnabled: false,
      }
    );
  }

  updatePreferences(prefs: UserPreferences): UserPreferences {
    this.prefs.set(prefs.claimantPublicKey, prefs);
    return prefs;
  }

  async getUserNotificationPreferences(
    userId: string,
  ): Promise<NotificationPreferences> {
    let storedPreferences = await this.preferencesRepository.findByUserId(userId);

    // Create record with defaults if it doesn't exist
    if (!storedPreferences) {
      await this.preferencesRepository.upsert({
        userId,
        renewalRemindersEnabled: DEFAULT_NOTIFICATION_PREFERENCES.renewalRemindersEnabled,
        claimUpdatesEnabled: DEFAULT_NOTIFICATION_PREFERENCES.claimUpdatesEnabled,
        email: null,
        emailVerified: false,
      });
      storedPreferences = await this.preferencesRepository.findByUserId(userId);
    }

    return this.resolveNotificationPreferences(storedPreferences);
  }

  async updateUserNotificationPreferences(
    userId: string,
    updates: NotificationPreferenceUpdate,
  ): Promise<NotificationPreferences> {
    const currentRecord = await this.preferencesRepository.findByUserId(userId);
    const resolvedPreferences = this.resolveNotificationPreferences(currentRecord);

    const nextPreferences: NotificationPreferences = {
      renewalRemindersEnabled:
        updates.renewalRemindersEnabled ?? resolvedPreferences.renewalRemindersEnabled,
      claimUpdatesEnabled:
        updates.claimUpdatesEnabled ?? resolvedPreferences.claimUpdatesEnabled,
    };

    await this.preferencesRepository.upsert({
      userId,
      renewalRemindersEnabled: nextPreferences.renewalRemindersEnabled,
      claimUpdatesEnabled: nextPreferences.claimUpdatesEnabled,
      // Preserve routing / email fields on the in-memory wholesale upsert.
      routing: currentRecord?.routing ?? null,
      email: currentRecord?.email ?? null,
      emailVerified: currentRecord?.emailVerified ?? false,
    });

    return nextPreferences;
  }

  async shouldSendNotification(
    userId: string,
    notificationType: NotificationType,
  ): Promise<boolean> {
    const preferences = await this.getUserNotificationPreferences(userId);
    return preferences[NOTIFICATION_TYPE_TO_PREFERENCE_KEY[notificationType]];
  }

  /**
   * Idempotently enqueue a notification for delivery by the BullMQ workers.
   *
   * Dedup key is `(userId, type, refId)` — a duplicate enqueue for the same
   * event is a no-op and produces exactly one delivery. Delivery is gated on
   * the user's `notification_preferences` opt-in flags: opted-out users get
   * nothing enqueued.
   */
  async enqueueNotification(job: NotificationJob): Promise<NotificationInboxRecord | null> {
    const dedupKey = `${job.userId}:${job.type}:${job.refId}`;

    if (this.enqueuedSet.has(dedupKey)) {
      this.logger.debug(`Duplicate notification enqueue skipped: ${dedupKey}`);
      return null;
    }

    const optedIn = await this.shouldSendNotification(job.userId, job.type);
    if (!optedIn) {
      this.logger.debug(`Notification suppressed by preferences: ${dedupKey}`);
      return null;
    }

    this.enqueuedSet.add(dedupKey);

    const record: NotificationInboxRecord = {
      id: dedupKey,
      userId: job.userId,
      type: job.type,
      refId: job.refId,
      channel: job.channel,
      payload: job.payload ?? null,
      acknowledgedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.inbox.set(record.id, record);

    // BullMQ workers (email / push) consume this job; delivery is already
    // gated above so opted-out users never reach the worker.
    this.logger.log(`Enqueued ${job.channel} notification ${dedupKey}`);
    return record;
  }

  /** Unacknowledged notification records for the authenticated user. */
  async listUnacknowledged(userId: string): Promise<NotificationInboxRecord[]> {
    return Array.from(this.inbox.values())
      .filter((record) => record.userId === userId && record.acknowledgedAt === null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Frontend acknowledgement of a notification record. */
  async acknowledge(userId: string, notificationId: string): Promise<NotificationInboxRecord> {
    const record = this.inbox.get(notificationId);
    if (!record || record.userId !== userId) {
      throw new NotFoundException(`Notification ${notificationId} not found`);
    }
    if (record.acknowledgedAt === null) {
      record.acknowledgedAt = new Date().toISOString();
      this.inbox.set(record.id, record);
    }
    return record;
  }

  async sendClaimNotifications(
    event: ClaimFinalizedEvent,
  ): Promise<NotificationRecord[]> {
    const prefs = this.getPreferences(event.claimantPublicKey);
    const records: NotificationRecord[] = [];

    records.push(await this.sendChannel('email', event, prefs, async () => {
      if (!prefs.emailEnabled || !prefs.email) return 'no-pref';
      const tmpl = buildClaimFinalizedEmail(event);
      await this.getTransport().sendMail({
        from: this.configService.get<string>('SMTP_FROM', 'niffyinsure@localhost'),
        to: prefs.email,
        subject: tmpl.subject,
        text: tmpl.text,
        html: tmpl.html,
      });
    }));

    records.push(await this.sendChannel('discord', event, prefs, async () => {
      const webhook = this.configService.get<string>('DISCORD_WEBHOOK_URL');
      if (!prefs.discordEnabled || !webhook) return 'no-pref';
      const content = buildClaimFinalizedDiscord(event);
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`Discord returned ${res.status}`);
    }));

    records.push(await this.sendChannel('telegram', event, prefs, async () => {
      const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
      if (!prefs.telegramEnabled || !prefs.telegramChatId || !token) return 'no-pref';
      const text = buildClaimFinalizedTelegram(event);
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: prefs.telegramChatId, text, parse_mode: 'HTML' }),
        },
      );
      if (!res.ok) throw new Error(`Telegram returned ${res.status}`);
    }));

    return records;
  }

  private async sendChannel(
    channel: 'email' | 'discord' | 'telegram',
    event: ClaimFinalizedEvent,
    _prefs: UserPreferences,
    fn: () => Promise<void | 'no-pref'>,
  ): Promise<NotificationRecord> {
    const key = `${event.claimantPublicKey}:${event.claimId}:${channel}`;

    if (this.sentSet.has(key)) {
      return { idempotencyKey: key, channel, status: 'skipped' };
    }

    try {
      const result = await withRetry(fn);
      if (result === 'no-pref') {
        return { idempotencyKey: key, channel, status: 'skipped' };
      }
      this.sentSet.add(key);
      return { idempotencyKey: key, channel, status: 'sent', sentAt: new Date().toISOString() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`${channel} failed for claim ${event.claimId}: ${msg}`);
      return { idempotencyKey: key, channel, status: 'failed', error: msg };
    }
  }

  /** Exposed for tests. */
  _clearSentSet() {
    this.sentSet.clear();
    this.enqueuedSet.clear();
    this.inbox.clear();
  }
}
