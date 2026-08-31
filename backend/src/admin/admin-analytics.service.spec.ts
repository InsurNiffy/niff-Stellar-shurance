import { ConfigService } from '@nestjs/config';
import { AdminAnalyticsService } from './admin-analytics.service';

const now = new Date('2026-06-26T12:00:00Z');

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    policyRenewal: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    policy: {
      count: jest.fn().mockResolvedValue(10),
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

function makeRedis(cached: unknown = null) {
  return {
    get: jest.fn().mockResolvedValue(cached),
    set: jest.fn().mockResolvedValue(undefined),
  };
}

function makeConfig(slaHours = 24) {
  return {
    get: jest.fn().mockImplementation((key: string, def?: number) => {
      if (key === 'SUPPORT_SLA_HOURS') return slaHours;
      return def;
    }),
  } as unknown as ConfigService;
}

function makeSupportService(stats = {}) {
  return {
    getFirstResponseStats: jest.fn().mockResolvedValue({
      totalResponded: 5,
      avgFirstResponseMs: 3600000,
      avgFirstResponseHours: 1,
      slaBreachedCount: 2,
      slaHours: 24,
      ...stats,
    }),
  };
}

describe('AdminAnalyticsService — getRenewalAnalytics', () => {
  it('returns cached result without hitting DB', async () => {
    const cachedData = { renewalRate: 0.5, totalRenewals: 5, cachedAt: now.toISOString() };
    const redis = makeRedis(cachedData);
    const svc = new AdminAnalyticsService(
      makePrisma() as never,
      redis as never,
      makeConfig(),
      makeSupportService() as never,
    );
    const result = await svc.getRenewalAnalytics();
    expect(result).toEqual(cachedData);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('computes and caches analytics on cache miss', async () => {
    const redis = makeRedis(null);
    const prisma = makePrisma();
    (prisma.policy.count as jest.Mock)
      .mockResolvedValueOnce(10)  // totalPolicies
      .mockResolvedValueOnce(3);  // lapsedCount
    const svc = new AdminAnalyticsService(prisma as never, redis as never, makeConfig(), makeSupportService() as never);
    const result = await svc.getRenewalAnalytics();
    expect(result.totalPolicies).toBe(10);
    expect(result.lapsedCount).toBe(3);
    expect(result.renewalRate).toBe(0); // no renewals
    expect(redis.set).toHaveBeenCalledWith(
      'admin:analytics:renewals:v1',
      expect.objectContaining({ cachedAt: expect.any(String) }),
      600,
    );
  });

  it('calculates renewalRate from unique renewed policy IDs', async () => {
    const redis = makeRedis(null);
    const renewals = [
      { policyCompositeId: 'G1:1', policyType: 'life', region: 'US', renewedAt: new Date() },
      { policyCompositeId: 'G1:1', policyType: 'life', region: 'US', renewedAt: new Date() }, // duplicate
      { policyCompositeId: 'G2:2', policyType: 'life', region: 'US', renewedAt: new Date() },
    ];
    const prisma = makePrisma();
    (prisma.policyRenewal.findMany as jest.Mock).mockResolvedValue(renewals);
    (prisma.policy.count as jest.Mock)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(2);
    (prisma.policy.findMany as jest.Mock).mockResolvedValue([
      { id: 'G1:1', createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      { id: 'G2:2', createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
    ]);
    (prisma.policy.groupBy as jest.Mock).mockResolvedValue([
      { policyType: 'life', region: 'US', _count: { id: 10 } },
    ]);

    const svc = new AdminAnalyticsService(prisma as never, redis as never, makeConfig(), makeSupportService() as never);
    const result = await svc.getRenewalAnalytics();
    expect(result.totalRenewals).toBe(2); // 2 unique policies renewed
    expect(result.renewalRate).toBeCloseTo(0.2); // 2/10
    expect(result.avgTimeToRenewalHours).toBeGreaterThan(0);
  });
});

describe('AdminAnalyticsService — getSupportAnalytics', () => {
  it('delegates to SupportService.getFirstResponseStats with configured SLA hours', async () => {
    const supportService = makeSupportService({ slaHours: 12 });
    const svc = new AdminAnalyticsService(
      makePrisma() as never,
      makeRedis() as never,
      makeConfig(12),
      supportService as never,
    );
    const result = await svc.getSupportAnalytics();
    expect(supportService.getFirstResponseStats).toHaveBeenCalledWith(12);
    expect(result.slaHours).toBe(12);
    expect(result.cachedAt).toBeDefined();
  });
});
