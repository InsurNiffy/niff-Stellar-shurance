/**
 * #1483 — notification routes: preference routing (GET/PUT), listing with
 * cursor pagination, read marker, and RFC 8058 one-click unsubscribe.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { InMemoryNotificationPreferencesRepository } from './notification-preferences.repository';
import { defaultRoutingPreferences } from './notification-preference.types';
import {
  resolveUnsubscribeSecret,
  signUnsubscribeToken,
} from './unsubscribe';

const WALLET = 'GAAAAAAAABCD';

function createController(overrides?: Partial<Record<keyof NotificationsService, jest.Mock>>) {
  const service = {
    getUserNotificationPreferences: jest.fn(async () => ({
      renewalRemindersEnabled: true,
      claimUpdatesEnabled: true,
    })),
    getRoutingPreferences: jest.fn(async () => defaultRoutingPreferences()),
    updateRoutingPreferences: jest.fn(async () => defaultRoutingPreferences()),
    listNotifications: jest.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
    markNotificationRead: jest.fn(async () => undefined),
    unsubscribeFromEmail: jest.fn(async () => ({ unsubscribed: true, scope: '*' })),
    ...overrides,
  };
  const config = {
    get: (key: string, defaultValue?: unknown) =>
      key === 'UNSUBSCRIBE_SECRET' ? 'test-secret' : defaultValue,
  };
  const controller = new NotificationsController(
    service as unknown as NotificationsService,
    { emit: jest.fn() } as never,
    config as never,
  );
  return { controller, service };
}

describe('GET /api/v1/notifications/preferences', () => {
  it('merges boolean preferences with routing preferences', async () => {
    const { controller, service } = createController();
    const result = await controller.getAuthenticatedUserPreferences(WALLET);

    expect(service.getUserNotificationPreferences).toHaveBeenCalledWith(WALLET);
    expect(service.getRoutingPreferences).toHaveBeenCalledWith(WALLET);
    expect(result).toMatchObject({
      renewalRemindersEnabled: true,
      claimUpdatesEnabled: true,
      quietHours: { enabled: false, start: '22:00', end: '07:00' },
      digestMode: 'off',
    });
    expect(result.events.claim_update).toEqual({ email: true, inApp: true });
  });
});

describe('PUT /api/v1/notifications/preferences', () => {
  it('updates per-event channels, quiet hours and digest mode', async () => {
    const { controller, service } = createController();

    await controller.updateRoutingPreferences(WALLET, {
      events: { claim_update: { email: false } },
      quietHours: { enabled: true, start: '22:30', end: '07:15' },
      digestMode: 'batch',
    });

    expect(service.updateRoutingPreferences).toHaveBeenCalledWith(WALLET, {
      events: { claim_update: { email: false } },
      quietHours: { enabled: true, start: '22:30', end: '07:15' },
      digestMode: 'batch',
    });
  });

  it('rejects unknown top-level fields', async () => {
    const { controller } = createController();
    await expect(
      controller.updateRoutingPreferences(WALLET, { emailEnabled: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown event types and channels', async () => {
    const { controller } = createController();
    await expect(
      controller.updateRoutingPreferences(WALLET, { events: { nope: { email: true } } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.updateRoutingPreferences(WALLET, {
        events: { claim_update: { sms: true } as never },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.updateRoutingPreferences(WALLET, {
        events: { claim_update: { email: 'yes' } as never },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects malformed quiet hours and digest modes', async () => {
    const { controller } = createController();
    await expect(
      controller.updateRoutingPreferences(WALLET, { quietHours: { start: '25:00' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.updateRoutingPreferences(WALLET, { digestMode: 'weekly' as never }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.updateRoutingPreferences(WALLET, { quietHours: { enabled: 'on' as never } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GET /api/v1/notifications', () => {
  it('passes cursor and limit through to the service', async () => {
    const { controller, service } = createController();
    await controller.listNotifications(WALLET, 'abc123', '5');
    expect(service.listNotifications).toHaveBeenCalledWith(WALLET, {
      cursor: 'abc123',
      limit: 5,
    });
  });

  it('defaults when no query params are given', async () => {
    const { controller, service } = createController();
    await controller.listNotifications(WALLET, undefined, undefined);
    expect(service.listNotifications).toHaveBeenCalledWith(WALLET, {
      cursor: undefined,
      limit: undefined,
    });
  });

  it('rejects a non-positive limit', async () => {
    const { controller } = createController();
    await expect(controller.listNotifications(WALLET, undefined, '0')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.listNotifications(WALLET, undefined, 'abc')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('POST /api/v1/notifications/:id/read', () => {
  it('marks the caller\'s notification as read', async () => {
    const { controller, service } = createController();
    await controller.markNotificationRead('notif-9', WALLET);
    expect(service.markNotificationRead).toHaveBeenCalledWith('notif-9', WALLET);
  });

  it('propagates not-found errors', async () => {
    const { controller } = createController({
      markNotificationRead: jest.fn(async () => {
        throw new NotFoundException();
      }) as never,
    });
    await expect(controller.markNotificationRead('missing', WALLET)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('POST /api/v1/notifications/unsubscribe (RFC 8058)', () => {
  it('verifies the token and disables email delivery for the scope', async () => {
    const { controller, service } = createController();
    const token = signUnsubscribeToken(
      { userId: WALLET, channel: 'email', scope: 'claim_update' },
      resolveUnsubscribeSecret({ get: (k: string) => (k === 'UNSUBSCRIBE_SECRET' ? 'test-secret' : undefined) }),
    );

    const result = await controller.unsubscribe(token);

    expect(service.unsubscribeFromEmail).toHaveBeenCalledWith(WALLET, 'claim_update');
    expect(result).toEqual({ unsubscribed: true, scope: '*' });
  });

  it('rejects a missing or invalid token', async () => {
    const { controller } = createController();
    await expect(controller.unsubscribe(undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.unsubscribe('forged.token')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const wrongSecret = signUnsubscribeToken({ userId: WALLET }, 'other-secret');
    await expect(controller.unsubscribe(wrongSecret)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('NotificationsService — notification listing', () => {
  function createServiceWithPrisma(rows: Array<Record<string, unknown>>) {
    const prisma = {
      notification: {
        findMany: jest.fn(
          async (args: {
            take?: number;
            skip?: number;
            cursor?: { id: string };
          }) => {
            let list = rows;
            if (args.cursor) {
              const index = rows.findIndex((row) => row.id === args.cursor!.id);
              if (index >= 0) list = rows.slice(index + (args.skip ?? 0));
            }
            return list.slice(0, args.take ?? list.length);
          },
        ),
        findUnique: jest.fn(async () => rows[0] ?? null),
        update: jest.fn(async () => undefined),
      },
    };
    const service = new NotificationsService(
      { get: (_k: string, d?: unknown) => d } as never,
      new InMemoryNotificationPreferencesRepository(),
      prisma as never,
    );
    return { service, prisma };
  }

  function makeRows(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `row-${count - i}`,
      userId: WALLET,
      type: 'claim_update',
      payload: { recordId: `claim-${i}` },
      acknowledgedAt: i % 2 === 0 ? new Date('2026-01-01T00:00:00Z') : null,
      createdAt: new Date(1_700_000_000_000 + i * 1000),
      expiresAt: null,
    }));
  }

  it('returns a page with read flags and a next cursor when more rows exist', async () => {
    const { service, prisma } = createServiceWithPrisma(makeRows(3));

    const page = await service.listNotifications(WALLET, { limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.items[0]).toMatchObject({ id: 'row-3', type: 'claim_update', read: true });
    expect(page.items[1]).toMatchObject({ id: 'row-2', read: false });
    expect(page.nextCursor).toBe(Buffer.from('row-2').toString('base64url'));
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: WALLET }, take: 3 }),
    );
  });

  it('decodes the cursor and skips the boundary row', async () => {
    const { service, prisma } = createServiceWithPrisma(makeRows(3));
    const cursor = Buffer.from('row-2').toString('base64url');

    const page = await service.listNotifications(WALLET, { cursor, limit: 2 });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'row-2' }, skip: 1 }),
    );
    expect(page.items.map((i) => i.id)).toEqual(['row-1']);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('rejects a malformed cursor', async () => {
    const { service } = createServiceWithPrisma([]);
    await expect(
      service.listNotifications(WALLET, { cursor: Buffer.from('row-2').toString('hex') }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('marks a notification read via the read marker (acknowledgedAt)', async () => {
    const { service, prisma } = createServiceWithPrisma([
      { id: 'row-1', userId: WALLET, acknowledgedAt: null },
    ]);

    await service.markNotificationRead('row-1', WALLET);

    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { acknowledgedAt: expect.any(Date) },
    });
  });

  it('refuses to mark another user\'s notification', async () => {
    const { service } = createServiceWithPrisma([
      { id: 'row-1', userId: 'SOMEONE_ELSE', acknowledgedAt: null },
    ]);
    await expect(service.markNotificationRead('row-1', WALLET)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
