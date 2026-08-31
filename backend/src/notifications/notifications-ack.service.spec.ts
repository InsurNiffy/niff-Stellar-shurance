import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { ConfigService } from '@nestjs/config';

const MOCK_NOTIF_ID = 'notif-uuid-1';
const MOCK_USER_ID = 'user-wallet-1';

function makeNotification(overrides: Partial<{
  id: string;
  userId: string;
  acknowledgedAt: Date | null;
}> = {}) {
  return {
    id: MOCK_NOTIF_ID,
    userId: MOCK_USER_ID,
    type: 'claim_update',
    payload: { claimId: '1' },
    acknowledgedAt: null,
    expiresAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makePrisma(notification = makeNotification()) {
  return {
    notification: {
      findUnique: jest.fn().mockResolvedValue(notification),
      update: jest.fn().mockResolvedValue({ ...notification, acknowledgedAt: new Date() }),
      create: jest.fn().mockResolvedValue({ ...notification, id: MOCK_NOTIF_ID }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function makePrefsRepo() {
  return { findByUserId: jest.fn().mockResolvedValue(null), upsert: jest.fn() };
}

function makeConfig() {
  return { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
}

function makeSvc(prisma = makePrisma()) {
  return new NotificationsService(
    makeConfig(),
    makePrefsRepo() as never,
    prisma as never,
  );
}

describe('NotificationsService — acknowledgeNotification', () => {
  it('marks notification as acknowledged', async () => {
    const prisma = makePrisma();
    const svc = makeSvc(prisma);
    await svc.acknowledgeNotification(MOCK_NOTIF_ID, MOCK_USER_ID);
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: MOCK_NOTIF_ID },
      data: { acknowledgedAt: expect.any(Date) },
    });
  });

  it('throws NotFoundException when notification not found', async () => {
    const prisma = makePrisma();
    (prisma.notification.findUnique as jest.Mock).mockResolvedValue(null);
    const svc = makeSvc(prisma);
    await expect(svc.acknowledgeNotification('bad-id', MOCK_USER_ID)).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when userId does not match', async () => {
    const prisma = makePrisma(makeNotification({ userId: 'other-user' }));
    const svc = makeSvc(prisma);
    await expect(svc.acknowledgeNotification(MOCK_NOTIF_ID, MOCK_USER_ID)).rejects.toThrow(NotFoundException);
  });

  it('is idempotent — does not update if already acknowledged', async () => {
    const alreadyAcked = makeNotification({ acknowledgedAt: new Date() });
    const prisma = makePrisma(alreadyAcked);
    const svc = makeSvc(prisma);
    await svc.acknowledgeNotification(MOCK_NOTIF_ID, MOCK_USER_ID);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });
});

describe('NotificationsService — createNotificationRecord', () => {
  it('creates record with expiresAt when ttlSeconds provided', async () => {
    const prisma = makePrisma();
    const svc = makeSvc(prisma);
    const id = await svc.createNotificationRecord({
      userId: MOCK_USER_ID,
      type: 'claim_update',
      payload: { claimId: '42' },
      ttlSeconds: 3600,
    });
    expect(id).toBe(MOCK_NOTIF_ID);
    const createCall = (prisma.notification.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.expiresAt).toBeDefined();
  });

  it('creates record without expiresAt when no ttl given', async () => {
    const prisma = makePrisma();
    const svc = makeSvc(prisma);
    await svc.createNotificationRecord({
      userId: MOCK_USER_ID,
      type: 'renewal_reminder',
      payload: { policyId: '1' },
    });
    const createCall = (prisma.notification.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.expiresAt).toBeUndefined();
  });
});

describe('NotificationsService — getStaleNotifications', () => {
  it('queries for unacknowledged notifications past expiry', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).getStaleNotifications(50);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          acknowledgedAt: null,
          expiresAt: { lt: expect.any(Date) },
        },
        take: 50,
      }),
    );
  });
});
