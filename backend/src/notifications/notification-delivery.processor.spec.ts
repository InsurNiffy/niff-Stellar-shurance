/**
 * #1483 — delivery worker processor (queue payloads are IDs only).
 */
import {
  buildEmailForNotification,
  createNotificationDeliveryProcessor,
  OutboundEmail,
} from './notification-delivery.processor';
import { InMemoryNotificationPreferencesRepository } from './notification-preferences.repository';

function createDeps(overrides?: {
  verified?: boolean;
  email?: string;
  rows?: Array<{ id: string; userId: string; type: string; payload: unknown }>;
}) {
  const preferences = new InMemoryNotificationPreferencesRepository();
  const sendMail = jest.fn(async (_message: OutboundEmail) => undefined);
  const rows = overrides?.rows ?? [
    {
      id: 'notif-1',
      userId: 'GABC',
      type: 'claim_update',
      payload: {
        type: 'claim_update',
        recordId: 'claim-1',
        claimId: 'claim-1',
        policyId: 7,
        outcome: 'Approved',
        finalizedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  ];
  const prisma = {
    notification: {
      findMany: jest.fn(async () => rows),
    },
  };
  return {
    preferences,
    sendMail,
    prisma,
    deps: {
      prisma: prisma as never,
      preferences,
      sendMail,
      unsubscribeSecret: 'test-secret',
      baseUrl: 'https://app.example.com',
    },
  };
}

const job = {
  data: {
    userId: 'GABC',
    notificationType: 'claim_update' as const,
    recordIds: ['notif-1'],
    channels: ['email' as const],
  },
};

describe('createNotificationDeliveryProcessor', () => {
  it('loads recipient and rows by ID and sends with RFC 8058 headers', async () => {
    const { deps, preferences, sendMail, prisma } = createDeps();
    await preferences.upsert({
      userId: 'GABC',
      renewalRemindersEnabled: true,
      claimUpdatesEnabled: true,
      email: 'user@example.com',
      emailVerified: true,
    });

    const processor = createNotificationDeliveryProcessor(deps);
    await processor(job);

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['notif-1'] }, userId: 'GABC' },
      select: { id: true, userId: true, type: true, payload: true },
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0][0];
    expect(message.to).toBe('user@example.com');
    expect(message.subject).toBeTruthy();
    expect(message.headers['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    );
    expect(message.headers['List-Unsubscribe']).toMatch(
      /^<https:\/\/app\.example\.com\/api\/v1\/notifications\/unsubscribe\?token=.+>$/,
    );
  });

  it('does not send when the email is unverified', async () => {
    const { deps, preferences, sendMail } = createDeps({ verified: false });
    await preferences.upsert({
      userId: 'GABC',
      renewalRemindersEnabled: true,
      claimUpdatesEnabled: true,
      email: 'user@example.com',
      emailVerified: false,
    });

    await createNotificationDeliveryProcessor(deps)(job);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('does not send when the email channel was not requested', async () => {
    const { deps, preferences, sendMail } = createDeps();
    await preferences.upsert({
      userId: 'GABC',
      renewalRemindersEnabled: true,
      claimUpdatesEnabled: true,
      email: 'user@example.com',
      emailVerified: true,
    });

    await createNotificationDeliveryProcessor(deps)({
      data: { ...job.data, channels: ['inApp'] },
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('ignores jobs without record IDs', async () => {
    const { deps, sendMail } = createDeps();
    await createNotificationDeliveryProcessor(deps)({
      data: { ...job.data, recordIds: [] },
    });
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('buildEmailForNotification', () => {
  it('renders the claim template from stored payload ids', () => {
    const template = buildEmailForNotification({
      id: 'n',
      userId: 'GABC',
      type: 'claim_update',
      payload: { claimId: 42, policyId: 7, outcome: 'Approved' },
    });
    expect(template).not.toBeNull();
    expect(template!.subject.toLowerCase()).toContain('claim');
    expect(template!.text).toContain('42');
    expect(template!.text).not.toContain('@');
  });

  it('renders the renewal template', () => {
    const template = buildEmailForNotification({
      id: 'n',
      userId: 'GABC',
      type: 'renewal_reminder',
      payload: { recordId: '5', policyId: 5, timeToExpiry: '7 days', expiryLedger: 100 },
    });
    expect(template).not.toBeNull();
    expect(template!.text).toContain('5');
  });

  it('falls back to a generic template when payload has a message', () => {
    const template = buildEmailForNotification({
      id: 'n',
      userId: 'GABC',
      type: 'custom',
      payload: { message: 'hello there' },
    });
    expect(template).toEqual({
      subject: 'NiffyInsure: custom',
      text: 'hello there',
    });
  });

  it('returns null when the payload cannot be rendered', () => {
    expect(
      buildEmailForNotification({ id: 'n', userId: 'u', type: 'claim_update', payload: {} }),
    ).toBeNull();
  });
});
