import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProfileService } from './profile.service';
import { maskEmail } from './email-mask';
import { UpdateProfileDto, SUPPORTED_LOCALES } from './profile.dto';
import {
  _resetLastSeenThrottle,
  LAST_SEEN_THROTTLE_MS,
  shouldTouchLastSeen,
} from '../common/throttle/last-seen.throttle';

const WALLET = 'GABC1234';

function makeDto(input: Record<string, unknown>) {
  return plainToInstance(UpdateProfileDto, input);
}

describe('UpdateProfileDto validation (#1485)', () => {
  it('accepts a fully valid payload', async () => {
    const errors = await validate(
      makeDto({ displayName: 'Alice B. Okafor', email: 'alice@example.com', locale: 'en' }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects malformed emails', async () => {
    const errors = await validate(makeDto({ email: 'not-an-email' }));
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejects display names with invalid charset or length', async () => {
    expect((await validate(makeDto({ displayName: '<script>alert(1)</script>' }))).length).toBeGreaterThan(0);
    expect((await validate(makeDto({ displayName: 'Bob; DROP TABLE' }))).length).toBeGreaterThan(0);
    expect((await validate(makeDto({ displayName: '   ' }))).length).toBeGreaterThan(0);
    expect((await validate(makeDto({ displayName: 'x'.repeat(81) }))).length).toBeGreaterThan(0);
    expect((await validate(makeDto({ displayName: "O'Neil-The 2nd." }))).length).toBe(0);
  });

  it('rejects unsupported locales but accepts supported ones', async () => {
    expect([...SUPPORTED_LOCALES]).toEqual(['en', 'es']);
    expect((await validate(makeDto({ locale: 'de' }))).length).toBeGreaterThan(0);
    expect((await validate(makeDto({ locale: 'fr' }))).length).toBeGreaterThan(0);
    expect((await validate(makeDto({ locale: 'es' }))).length).toBe(0);
  });

  it('keeps the profile optional — every field is optional', async () => {
    expect(await validate(makeDto({}))).toHaveLength(0);
  });
});

describe('email masking in the audit log (#1485)', () => {
  it('masks the local part, keeping the domain', () => {
    expect(maskEmail('alice@example.com')).toBe('a***@example.com');
    expect(maskEmail('a@example.com')).toBe('*@example.com');
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail('not-an-email')).toBe('***');
  });

  it('never returns the full local part', () => {
    const masked = maskEmail('verysecretaddress@example.com');
    expect(masked).not.toContain('verysecretaddress');
  });
});

const defaultProfile = {
  walletAddress: WALLET,
  displayName: 'Alice',
  email: 'alice@example.com',
  locale: 'en',
  notificationPreferences: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSeenAt: null,
};

function buildService() {
  const prisma = {
    holderProfile: {
      findUnique: jest.fn().mockResolvedValue(defaultProfile),
      upsert: jest.fn().mockResolvedValue(defaultProfile),
    },
    profileAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  return { prisma, service: new ProfileService(prisma as never) };
}

describe('ProfileService — audit rows (#1485)', () => {
  it('writes one row per changed field with old and new values', async () => {
    const { prisma, service } = buildService();
    prisma.holderProfile.upsert.mockResolvedValue({ ...defaultProfile, displayName: 'Alicia' });

    await service.update(WALLET, { displayName: 'Alicia' });

    expect(prisma.profileAuditLog.create).toHaveBeenCalledWith({
      data: {
        walletAddress: WALLET,
        fieldName: 'displayName',
        oldValue: 'Alice',
        newValue: 'Alicia',
        actor: WALLET,
      },
    });
  });

  it('masks emails in the audit row', async () => {
    const { prisma, service } = buildService();
    prisma.holderProfile.findUnique.mockResolvedValue({
      ...defaultProfile,
      email: 'old@example.com',
    });
    prisma.holderProfile.upsert.mockResolvedValue({
      ...defaultProfile,
      email: 'new@example.com',
    });

    await service.update(WALLET, { email: 'new@example.com' });

    expect(prisma.profileAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fieldName: 'email',
        oldValue: 'o***@example.com',
        newValue: 'n***@example.com',
      }),
    });

    const written = JSON.stringify(prisma.profileAuditLog.create.mock.calls);
    expect(written).not.toContain('old@example.com');
    expect(written).not.toContain('new@example.com');
  });

  it('writes no audit rows when values are unchanged', async () => {
    const { prisma, service } = buildService();

    await service.update(WALLET, { displayName: 'Alice', locale: 'en' });

    expect(prisma.profileAuditLog.create).not.toHaveBeenCalled();
  });

  it('writes no audit rows when nothing is supplied', async () => {
    const { prisma, service } = buildService();

    await service.update(WALLET, {});

    expect(prisma.profileAuditLog.create).not.toHaveBeenCalled();
    expect(prisma.holderProfile.upsert).toHaveBeenCalled();
  });
});

describe('lastSeenAt throttling (#1485)', () => {
  beforeEach(() => _resetLastSeenThrottle());

  it('permits one update per user per 5 minutes', () => {
    const t0 = 1_700_000_000_000;
    expect(shouldTouchLastSeen('G1', t0)).toBe(true);
    expect(shouldTouchLastSeen('G1', t0 + 60_000)).toBe(false);
    expect(shouldTouchLastSeen('G1', t0 + LAST_SEEN_THROTTLE_MS - 1)).toBe(false);
    expect(shouldTouchLastSeen('G1', t0 + LAST_SEEN_THROTTLE_MS)).toBe(true);
  });

  it('tracks each user independently', () => {
    const t0 = 1_700_000_000_000;
    expect(shouldTouchLastSeen('G1', t0)).toBe(true);
    expect(shouldTouchLastSeen('G2', t0)).toBe(true);
    expect(shouldTouchLastSeen('G1', t0 + 1)).toBe(false);
    expect(shouldTouchLastSeen('G2', t0 + 1)).toBe(false);
  });

  it('ProfileService.touchLastSeen writes at most once per window', () => {
    const prisma = { holderProfile: { upsert: jest.fn().mockResolvedValue({}) } };
    const service = new ProfileService(prisma as never);

    service.touchLastSeen('GTHROTTLED');
    service.touchLastSeen('GTHROTTLED');
    service.touchLastSeen('GTHROTTLED');

    expect(prisma.holderProfile.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.holderProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { walletAddress: 'GTHROTTLED' },
        update: expect.objectContaining({ lastSeenAt: expect.any(Date) }),
      }),
    );
  });
});
