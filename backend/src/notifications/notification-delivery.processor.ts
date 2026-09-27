/**
 * Notification delivery processor — runs inside the BullMQ worker (#1483).
 *
 * Queue payloads contain IDs only. Everything else (notification details,
 * recipient email, unsubscribe secret) is loaded here, in the worker:
 *  - notification rows by ID → template context
 *  - preference record by user ID → recipient email (must be verified)
 *
 * Every email carries RFC 8058 `List-Unsubscribe` /
 * `List-Unsubscribe-Post` headers with an HMAC-signed one-click URL.
 */
import type { PrismaService } from '../prisma/prisma.service';
import {
  NotificationPreferencesRepository,
} from './notification-preferences.repository';
import type { NotificationDeliveryJob } from './notification-dispatch.service';
import type { NotificationJobData } from './notification-jobs.queue';
import {
  buildClaimFinalizedEmail,
  PolicyExpiryEmailTemplate,
} from './notification.templates';
import {
  buildUnsubscribeHeaders,
  buildUnsubscribeUrl,
  signUnsubscribeToken,
} from './unsubscribe';

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers: Record<string, string>;
}

export interface DeliveryProcessorDeps {
  prisma: Pick<PrismaService, 'notification'>;
  preferences: NotificationPreferencesRepository;
  sendMail: (message: OutboundEmail) => Promise<void> | void;
  unsubscribeSecret: string;
  /** Public base URL used to build the one-click unsubscribe link. */
  baseUrl: string;
}

interface NotificationRow {
  id: string;
  userId: string;
  type: string;
  payload: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * Renders an email for a stored notification row. Only IDs, outcomes and
 * timestamps are used — no personal data beyond the recipient's wallet id.
 */
export function buildEmailForNotification(
  row: NotificationRow,
): { subject: string; text: string; html?: string } | null {
  const payload = asRecord(row.payload);

  if (row.type === 'claim_update') {
    const claimId = payload.claimId ?? payload.recordId;
    if (claimId === undefined || payload.policyId === undefined) return null;
    return buildClaimFinalizedEmail({
      claimId: String(claimId),
      policyId: Number(payload.policyId),
      claimantPublicKey: row.userId,
      outcome: (payload.outcome as 'Approved' | 'Rejected') ?? 'Approved',
      finalizedAt: String(payload.finalizedAt ?? new Date().toISOString()),
    });
  }

  if (row.type === 'renewal_reminder') {
    const policyId = payload.policyId ?? payload.recordId;
    if (policyId === undefined) return null;
    return PolicyExpiryEmailTemplate({
      policyId: Number(policyId),
      holderPublicKey: row.userId,
      expiryLedger: Number(payload.expiryLedger ?? 0),
      timeToExpiry: String(payload.timeToExpiry ?? 'soon'),
    });
  }

  const message = payload.message;
  if (typeof message !== 'string' || message.length === 0) return null;
  return { subject: `NiffyInsure: ${row.type}`, text: message };
}

/** Creates the BullMQ job processor for notification delivery. */
export function createNotificationDeliveryProcessor(deps: DeliveryProcessorDeps) {
  return async function processNotificationDelivery(
    job: { data: NotificationJobData | NotificationDeliveryJob },
  ): Promise<void> {
    const { userId, recordIds, channels } = job.data;

    if (!userId || !Array.isArray(recordIds) || recordIds.length === 0) return;
    if (!Array.isArray(channels) || !channels.includes('email')) return;

    // Load recipient in the worker — never carried in the queue payload.
    const prefs = await deps.preferences.findByUserId(userId);
    if (!prefs?.emailVerified || !prefs.email) return;

    const rows: NotificationRow[] = await deps.prisma.notification.findMany({
      where: { id: { in: recordIds }, userId },
      select: { id: true, userId: true, type: true, payload: true },
    });

    for (const row of rows) {
      const template = buildEmailForNotification(row);
      if (!template) continue;

      const token = signUnsubscribeToken(
        { userId, channel: 'email', scope: row.type },
        deps.unsubscribeSecret,
      );
      const url = buildUnsubscribeUrl(token, deps.baseUrl);

      await deps.sendMail({
        to: prefs.email,
        subject: template.subject,
        text: template.text,
        html: template.html,
        headers: buildUnsubscribeHeaders(url),
      });
    }
  };
}
