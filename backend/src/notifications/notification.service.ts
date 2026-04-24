/**
 * Notification service.
 *
 * Responsibilities:
 *   - Send claim-finalized notifications via email, Discord, Telegram.
 *   - Enforce idempotency: each (claimant, claimId, channel) is sent at most once.
 *   - Retry with exponential backoff (max 3 attempts).
 *   - Respect per-user opt-out preferences.
 *   - Log failures with enough context for alert hooks.
 *
 * Provider configuration:
 *   - Email: nodemailer against SMTP (Mailhog-compatible for local dev).
 *   - Discord: HTTP POST to DISCORD_WEBHOOK_URL (env var).
 *   - Telegram: HTTP POST to the Bot API via TELEGRAM_BOT_TOKEN (env var).
 *
 * Store SMTP credentials, webhook URLs, and bot tokens in secrets management
 * (e.g. Doppler, AWS Secrets Manager) — never commit them to source control.
 *
 * Data minimisation: templates expose only claim_id, policy_id, and outcome.
 * Sensitive evidence details are never embedded in outbound messages.
 */

import nodemailer from 'nodemailer';
import type {
  ClaimFinalizedEvent,
  NotificationRecord,
  NotificationResult,
  UserPreferences,
} from './notification.types';
import {
  buildClaimFinalizedEmail,
  buildClaimFinalizedDiscord,
  buildClaimFinalizedTelegram,
} from './notification.templates';
import { config } from '../config/env';
import { getRuntimeEnv } from '../config/runtime-env';

const env = getRuntimeEnv();
const isTestEnv = env.NODE_ENV === 'test';

// ── Idempotency store (in-memory; replace with Redis Set in production) ───────

const sentSet = new Set<string>();

function idempotencyKey(
  claimantPublicKey: string,
  claimId: string,
  channel: string,
): string {
  return `${claimantPublicKey}:${claimId}:${channel}`;
}

// ── User preference store (in-memory; replace with DB in production) ──────────
// Default: email opt-in, Discord/Telegram opt-out.

const preferencesStore = new Map<string, UserPreferences>();

export function getPreferences(claimantPublicKey: string): UserPreferences {
  return (
    preferencesStore.get(claimantPublicKey) ?? {
      claimantPublicKey,
      emailEnabled: true,
      discordEnabled: false,
      telegramEnabled: false,
    }
  );
}

export function updatePreferences(prefs: UserPreferences): UserPreferences {
  preferencesStore.set(prefs.claimantPublicKey, prefs);
  return prefs;
}

// ── Nodemailer transport (lazy singleton) ─────────────────────────────────────

let _transport: nodemailer.Transporter | null = null;

function getTransport(): nodemailer.Transporter {
  if (_transport) return _transport;
  _transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    auth:
      config.smtp.user && config.smtp.pass
        ? { user: config.smtp.user, pass: config.smtp.pass }
        : undefined,
    // Mailhog doesn't use TLS
    secure: config.smtp.port === 465,
  });
  return _transport;
}

/** Exposed for tests to inject a mock transport. */
export function _setTransportForTests(t: nodemailer.Transporter): void {
  _transport = t;
}

// ── Retry helper ──────────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 500,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
      }
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

// ── Channel senders ───────────────────────────────────────────────────────────

async function sendEmail(
  event: ClaimFinalizedEvent,
  email: string,
): Promise<void> {
  const tmpl = buildClaimFinalizedEmail(event);
  const transport = getTransport();
  await transport.sendMail({
    from: config.smtp.from,
    to: email,
    subject: tmpl.subject,
    text: tmpl.text,
    html: tmpl.html,
  });
}

async function sendDiscord(
  event: ClaimFinalizedEvent,
  webhookUrl: string,
): Promise<void> {
  const content = buildClaimFinalizedDiscord(event);
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook returned ${res.status}`);
  }
}

async function sendTelegram(
  event: ClaimFinalizedEvent,
  chatId: string,
): Promise<void> {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN not configured');
  const text = buildClaimFinalizedTelegram(event);
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  if (!res.ok) {
    throw new Error(`Telegram API returned ${res.status}`);
  }
}

// ── Main send function ────────────────────────────────────────────────────────

/**
 * Send claim-finalized notifications for a single event.
 * Idempotent: repeated calls with the same (claimant, claimId, channel)
 * are silently skipped.
 */
export async function sendClaimNotifications(
  event: ClaimFinalizedEvent,
): Promise<NotificationResult> {
  const prefs = getPreferences(event.claimantPublicKey);
  const records: NotificationRecord[] = [];

  // ── Email ──────────────────────────────────────────────────────────────────
  const emailKey = idempotencyKey(event.claimantPublicKey, event.claimId, 'email');
  if (!prefs.emailEnabled || !prefs.email) {
    records.push({
      idempotencyKey: emailKey,
      channel: 'email',
      status: 'skipped',
    });
  } else if (sentSet.has(emailKey)) {
    records.push({
      idempotencyKey: emailKey,
      channel: 'email',
      status: 'skipped',
    });
  } else {
    try {
      await withRetry(() => sendEmail(event, prefs.email!));
      sentSet.add(emailKey);
      records.push({
        idempotencyKey: emailKey,
        channel: 'email',
        status: 'sent',
        sentAt: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isTestEnv) {
        console.error(`[notification] email failed for claim ${event.claimId}:`, msg);
      }
      records.push({
        idempotencyKey: emailKey,
        channel: 'email',
        status: 'failed',
        error: msg,
      });
    }
  }

  // ── Discord ────────────────────────────────────────────────────────────────
  const discordWebhook = env.DISCORD_WEBHOOK_URL;
  const discordKey = idempotencyKey(event.claimantPublicKey, event.claimId, 'discord');
  if (!prefs.discordEnabled || !discordWebhook) {
    records.push({
      idempotencyKey: discordKey,
      channel: 'discord',
      status: 'skipped',
    });
  } else if (sentSet.has(discordKey)) {
    records.push({
      idempotencyKey: discordKey,
      channel: 'discord',
      status: 'skipped',
    });
  } else {
    try {
      await withRetry(() => sendDiscord(event, discordWebhook));
      sentSet.add(discordKey);
      records.push({
        idempotencyKey: discordKey,
        channel: 'discord',
        status: 'sent',
        sentAt: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isTestEnv) {
        console.error(`[notification] discord failed for claim ${event.claimId}:`, msg);
      }
      records.push({
        idempotencyKey: discordKey,
        channel: 'discord',
        status: 'failed',
        error: msg,
      });
    }
  }

  // ── Telegram ───────────────────────────────────────────────────────────────
  const telegramKey = idempotencyKey(event.claimantPublicKey, event.claimId, 'telegram');
  if (!prefs.telegramEnabled || !prefs.telegramChatId) {
    records.push({
      idempotencyKey: telegramKey,
      channel: 'telegram',
      status: 'skipped',
    });
  } else if (sentSet.has(telegramKey)) {
    records.push({
      idempotencyKey: telegramKey,
      channel: 'telegram',
      status: 'skipped',
    });
  } else {
    try {
      await withRetry(() => sendTelegram(event, prefs.telegramChatId!));
      sentSet.add(telegramKey);
      records.push({
        idempotencyKey: telegramKey,
        channel: 'telegram',
        status: 'sent',
        sentAt: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isTestEnv) {
        console.error(`[notification] telegram failed for claim ${event.claimId}:`, msg);
      }
      records.push({
        idempotencyKey: telegramKey,
        channel: 'telegram',
        status: 'failed',
        error: msg,
      });
    }
  }

  return { claimId: event.claimId, records };
}

/** Exposed for tests to clear the in-memory idempotency set. */
export function _clearSentSetForTests(): void {
  sentSet.clear();
}
