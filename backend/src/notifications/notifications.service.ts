/**
 * NotificationsService — idempotent claim-finalized notifications.
 *
 * Channels: email (Mailhog-compatible SMTP), Discord webhook, Telegram Bot API.
 * Credentials stored in env vars / secrets management — never in source.
 * PII minimisation: only claim_id, policy_id, outcome in templates.
 * Default: email opt-in, Discord/Telegram opt-out.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type {
  ClaimFinalizedEvent,
  NotificationRecord,
  UserPreferences,
} from './notification.types';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_TYPE_TO_PREFERENCE_KEY,
  NotificationPreferenceRecord,
  NotificationPreferences,
  NotificationPreferenceUpdate,
  NotificationType,
} from './notification-preference.types';
import {
  NOTIFICATION_PREFERENCES_REPOSITORY,
  NotificationPreferencesRepository,
} from './notification-preferences.repository';
import {
  buildClaimFinalizedEmail,
  buildClaimFinalizedDiscord,
  buildClaimFinalizedTelegram,
} from './notification.templates';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  // In-memory stores — replace with Prisma in production
  private readonly sentSet = new Set<string>();
  private readonly prefs = new Map<string, UserPreferences>();

  private transport: nodemailer.Transporter | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Inject(NOTIFICATION_PREFERENCES_REPOSITORY)
    private readonly preferencesRepository: NotificationPreferencesRepository,
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
    const storedPreferences = await this.preferencesRepository.findByUserId(userId);
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
  }

  private resolveNotificationPreferences(
    record: NotificationPreferenceRecord | null,
  ): NotificationPreferences {
    return {
      renewalRemindersEnabled:
        record?.renewalRemindersEnabled ??
        DEFAULT_NOTIFICATION_PREFERENCES.renewalRemindersEnabled,
      claimUpdatesEnabled:
        record?.claimUpdatesEnabled ??
        DEFAULT_NOTIFICATION_PREFERENCES.claimUpdatesEnabled,
    };
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 500,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, i)));
      }
    }
  }
  throw lastErr;
}
