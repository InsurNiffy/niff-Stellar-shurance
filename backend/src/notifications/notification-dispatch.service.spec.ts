/**
 * #1483 — preference-aware notification dispatcher.
 *
 * Covers: per-event × channel routing, quiet-hours deferral, digest batching,
 * email-verification gating, and the "queue payloads contain IDs only" rule.
 */
import { NotificationDispatchService } from './notification-dispatch.service';
import {
  InMemoryNotificationPreferencesRepository,
} from './notification-preferences.repository';
import { defaultRoutingPreferences } from './notification-preference.types';

function createPrismaMock() {
  let seq = 0;
  return {
    notification: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        seq += 1;
        return { id: `notif-${seq}`, ...args.data };
      }),
    },
  };
}

function createService(options?: {
  digestWindowMs?: number;
}) {
  const prisma = createPrismaMock();
  const preferences = new InMemoryNotificationPreferencesRepository();
  const config = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === 'NOTIFICATION_DIGEST_WINDOW_MS') {
        return options?.digestWindowMs ?? 60_000;
      }
      return defaultValue;
    }),
  };
  const enqueue = jest.fn(
    async (
      _job: {
        userId: string;
        notificationType: string;
        recordIds: string[];
        channels: string[];
      },
      _delayMs?: number,
    ) => 'job-1',
  );
  const service = new NotificationDispatchService(
    prisma as never,
    preferences,
    config as never,
    enqueue,
  );
  return { service, prisma, preferences, enqueue };
}

async function seedPreferences(
  repository: InMemoryNotificationPreferencesRepository,
  userId: string,
  overrides: Partial<Awaited<ReturnType<InMemoryNotificationPreferencesRepository['findByUserId']>>> = {},
) {
  await repository.upsert({
    userId,
    renewalRemindersEnabled: true,
    claimUpdatesEnabled: true,
    email: 'user@example.com',
    emailVerified: true,
    routing: defaultRoutingPreferences(),
    ...overrides,
  });
}

describe('NotificationDispatchService — channel routing', () => {
  it('defaults to in-app only for a brand-new user (no verified email yet)', async () => {
    const { service, prisma, enqueue } = createService();

    const outcome = await service.dispatch({
      type: 'claim_update',
      userId: 'u1',
      recordId: 'claim-1',
      context: { policyId: 7, outcome: 'Approved' },
    });

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(outcome.channels).toEqual(['inApp']);
    expect(enqueue).not.toHaveBeenCalled();
    expect(outcome.skipped).toEqual(
      expect.arrayContaining([
        { channel: 'email', reason: 'email_unverified' },
      ]),
    );
  });

  it('creates an in-app row and enqueues an email job when fully routed', async () => {
    const { service, prisma, preferences, enqueue } = createService();
    await seedPreferences(preferences, 'u1');

    const outcome = await service.dispatch({
      type: 'claim_update',
      userId: 'u1',
      recordId: 'claim-1',
      context: { policyId: 7, outcome: 'Approved' },
    });

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(outcome.notificationId).toBe('notif-1');
    expect(outcome.channels).toEqual(['inApp', 'email']);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(outcome.digested).toBe(false);
  });

  it('serves only the in-app channel when email is unrouted', async () => {
    const { service, preferences, enqueue } = createService();
    const routing = defaultRoutingPreferences();
    routing.events.claim_update = { email: false, inApp: true };
    await seedPreferences(preferences, 'u1', { routing });

    const outcome = await service.dispatch({
      type: 'claim_update',
      userId: 'u1',
      recordId: 'claim-1',
    });

    expect(outcome.channels).toEqual(['inApp']);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('suppresses the in-app row (already read) when only email is routed', async () => {
    const { service, prisma, preferences, enqueue } = createService();
    const routing = defaultRoutingPreferences();
    routing.events.claim_update = { email: true, inApp: false };
    await seedPreferences(preferences, 'u1', { routing });

    const outcome = await service.dispatch({
      type: 'claim_update',
      userId: 'u1',
      recordId: 'claim-1',
    });

    expect(outcome.channels).toEqual(['email']);
    const created = (prisma.notification.create as jest.Mock).mock.calls[0][0];
    expect(created.data.acknowledgedAt).toBeInstanceOf(Date);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('skips everything when the master preference switch is off', async () => {
    const { service, prisma, preferences, enqueue } = createService();
    await seedPreferences(preferences, 'u1', { claimUpdatesEnabled: false });

    const outcome = await service.dispatch({
      type: 'claim_update',
      userId: 'u1',
      recordId: 'claim-1',
    });

    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(outcome.notificationId).toBeNull();
    expect(outcome.skipped).toEqual(
      expect.arrayContaining([
        { channel: 'email', reason: 'preference_disabled' },
        { channel: 'inApp', reason: 'preference_disabled' },
      ]),
    );
  });

  it('does not send email unless the address is verified', async () => {
    const { service, preferences, enqueue } = createService();
    await seedPreferences(preferences, 'u1', { emailVerified: false });

    const outcome = await service.dispatch({
      type: 'claim_update',
      userId: 'u1',
      recordId: 'claim-1',
    });

    expect(enqueue).not.toHaveBeenCalled();
    expect(outcome.channels).toEqual(['inApp']);
    expect(outcome.skipped).toEqual(
      expect.arrayContaining([{ channel: 'email', reason: 'email_unverified' }]),
    );
  });
});

describe('NotificationDispatchService — queue payloads contain IDs only', () => {
  it('enqueues userId + row IDs, never email or template context', async () => {
    const { service, preferences, enqueue } = createService();
    await seedPreferences(preferences, 'u1', { email: 'pii@example.com' });

    await service.dispatch({
      type: 'claim_update',
      userId: 'u1',
      recordId: 'claim-1',
      context: { policyId: 7, outcome: 'Approved' },
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    const job = enqueue.mock.calls[0][0];
    expect(job).toEqual({
      userId: 'u1',
      notificationType: 'claim_update',
      recordIds: ['notif-1'],
      channels: ['email'],
    });
    expect(JSON.stringify(job)).not.toContain('pii@example.com');
    expect(JSON.stringify(job)).not.toContain('claim-1');
    expect(JSON.stringify(job)).not.toContain('Approved');
  });
});

describe('NotificationDispatchService — quiet hours', () => {
  it('defers the email job until the quiet window ends', async () => {
    jest.useFakeTimers({ now: new Date('2026-01-01T23:00:00.000Z') });
    try {
      const { service, preferences, enqueue } = createService();
      const routing = defaultRoutingPreferences();
      routing.quietHours = { enabled: true, start: '22:00', end: '07:00' };
      await seedPreferences(preferences, 'u1', { routing });

      const outcome = await service.dispatch({
        type: 'renewal_reminder',
        userId: 'u1',
        recordId: 'policy-1',
      });

      expect(enqueue).toHaveBeenCalledTimes(1);
      const delayMs = enqueue.mock.calls[0][1] ?? 0;
      expect(delayMs).toBe(8 * 60 * 60 * 1000); // 23:00 → 07:00
      expect(outcome.deferredUntil).toBe('2026-01-02T07:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not defer outside the quiet window', async () => {
    jest.useFakeTimers({ now: new Date('2026-01-01T12:00:00.000Z') });
    try {
      const { service, preferences, enqueue } = createService();
      const routing = defaultRoutingPreferences();
      routing.quietHours = { enabled: true, start: '22:00', end: '07:00' };
      await seedPreferences(preferences, 'u1', { routing });

      const outcome = await service.dispatch({
        type: 'renewal_reminder',
        userId: 'u1',
        recordId: 'policy-1',
      });

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0][1]).toBe(0);
      expect(outcome.deferredUntil).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('NotificationDispatchService — digest batching', () => {
  it('buffers claim updates and flushes them as a single job', async () => {
    const { service, preferences, enqueue } = createService({ digestWindowMs: 60_000 });
    const routing = defaultRoutingPreferences();
    routing.digestMode = 'batch';
    await seedPreferences(preferences, 'u1', { routing });

    const first = await service.dispatch({
      type: 'claim_update',
      userId: 'u1',
      recordId: 'claim-1',
    });
    const second = await service.dispatch({
      type: 'claim_update',
      userId: 'u1',
      recordId: 'claim-2',
    });

    expect(first.digested).toBe(true);
    expect(second.digested).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
    expect(service.peekDigests()).toEqual({ u1: ['notif-1', 'notif-2'] });

    const flushed = await service.flushDigests();
    expect(flushed).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    const job = enqueue.mock.calls[0][0];
    expect(job.recordIds).toEqual(['notif-1', 'notif-2']);
    expect(service.peekDigests()).toEqual({});
  });

  it('sends immediately for non-claim events even in digest mode', async () => {
    const { service, preferences, enqueue } = createService();
    const routing = defaultRoutingPreferences();
    routing.digestMode = 'daily';
    await seedPreferences(preferences, 'u1', { routing });

    await service.dispatch({
      type: 'renewal_reminder',
      userId: 'u1',
      recordId: 'policy-1',
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(service.peekDigests()).toEqual({});
  });
});
