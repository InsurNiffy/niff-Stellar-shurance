import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../cache/redis.service';
import { SupportService } from '../support/support.service';

const RENEWALS_CACHE_KEY = 'admin:analytics:renewals:v1';
const RENEWALS_CACHE_TTL = 600; // 10 minutes
const POLICIES_CACHE_KEY_PREFIX = 'admin:analytics:policies:v1';
const POLICIES_CACHE_TTL = 300; // 5 minutes

export interface RenewalGroupStats {
  policyType: string;
  region: string;
  renewalCount: number;
  totalPolicies: number;
  renewalRate: number;
  avgTimeToRenewalHours: number | null;
}

export interface RenewalAnalytics {
  renewalRate: number;
  totalRenewals: number;
  totalPolicies: number;
  lapsedCount: number;
  avgTimeToRenewalHours: number | null;
  byGroup: RenewalGroupStats[];
  cachedAt: string;
}

export interface SupportAnalytics {
  avgFirstResponseMs: number | null;
  avgFirstResponseHours: number | null;
  totalResponded: number;
  slaBreachedCount: number;
  slaHours: number;
  cachedAt: string;
}

export interface PolicyAnalyticsBreakdown {
  policyType: string;
  region: string;
  coverageAmountBucket: string;
  isActive: boolean;
  count: number;
}

export interface PolicyAnalytics {
  totalPolicies: number;
  activePolicies: number;
  breakdown: PolicyAnalyticsBreakdown[];
  cachedAt: string;
}

@Injectable()
export class AdminAnalyticsService {
  private readonly logger = new Logger(AdminAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly supportService: SupportService,
  ) {}

  async getRenewalAnalytics(): Promise<RenewalAnalytics> {
    const cached = await this.redis.get<RenewalAnalytics>(RENEWALS_CACHE_KEY);
    if (cached) return cached;

    const result = await this.computeRenewalAnalytics();
    await this.redis.set(RENEWALS_CACHE_KEY, result, RENEWALS_CACHE_TTL);
    return result;
  }

  private async computeRenewalAnalytics(): Promise<RenewalAnalytics> {
    const [renewals, totalPolicies, lapsedCount, policiesByGroup] = await Promise.all([
      this.prisma.policyRenewal.findMany({
        select: { policyCompositeId: true, policyType: true, region: true, renewedAt: true },
      }),
      this.prisma.policy.count({ where: { deletedAt: null } }),
      this.prisma.policy.count({ where: { isActive: false, deletedAt: null } }),
      this.prisma.policy.groupBy({
        by: ['policyType', 'region'],
        where: { deletedAt: null },
        _count: { id: true },
      }),
    ]);

    // Unique policies that have been renewed at least once
    const renewedPolicyIds = new Set(renewals.map((r) => r.policyCompositeId));
    const totalRenewals = renewedPolicyIds.size;
    const renewalRate = totalPolicies > 0 ? totalRenewals / totalPolicies : 0;

    // Use the first renewal per policy for avg calculation
    const firstRenewalPerPolicy = new Map<string, Date>();
    for (const r of renewals) {
      const existing = firstRenewalPerPolicy.get(r.policyCompositeId);
      if (!existing || r.renewedAt < existing) {
        firstRenewalPerPolicy.set(r.policyCompositeId, r.renewedAt);
      }
    }

    // Build per-group stats
    const groupMap = new Map<string, { renewalCount: number; firstRenewals: Map<string, Date> }>();
    for (const r of renewals) {
      const key = `${r.policyType}|${r.region}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, { renewalCount: 0, firstRenewals: new Map() });
      }
      const g = groupMap.get(key)!;
      const existing = g.firstRenewals.get(r.policyCompositeId);
      if (!existing || r.renewedAt < existing) {
        g.firstRenewals.set(r.policyCompositeId, r.renewedAt);
      }
      g.renewalCount = g.firstRenewals.size;
    }

    // Build per-policy createdAt lookup (needed for global and group-level avg)
    const policyCreatedAt = new Map<string, Date>();
    if (renewedPolicyIds.size > 0) {
      const policies = await this.prisma.policy.findMany({
        where: { id: { in: [...renewedPolicyIds] }, deletedAt: null },
        select: { id: true, createdAt: true },
      });
      for (const p of policies) policyCreatedAt.set(p.id, p.createdAt);
    }

    // Global average time-to-renewal
    let avgTimeToRenewalHours: number | null = null;
    if (firstRenewalPerPolicy.size > 0) {
      const durations: number[] = [];
      for (const [pId, renewedAt] of firstRenewalPerPolicy) {
        const created = policyCreatedAt.get(pId);
        if (created) {
          durations.push((renewedAt.getTime() - created.getTime()) / (1000 * 60 * 60));
        }
      }
      if (durations.length > 0) {
        avgTimeToRenewalHours = durations.reduce((a, b) => a + b, 0) / durations.length;
      }
    }

    const byGroup: RenewalGroupStats[] = policiesByGroup.map((pg) => {
      const key = `${pg.policyType}|${pg.region}`;
      const grp = groupMap.get(key);
      const groupPolicies = pg._count.id;
      const groupRenewals = grp?.renewalCount ?? 0;

      let groupAvgHours: number | null = null;
      if (grp && grp.firstRenewals.size > 0) {
        const durations: number[] = [];
        for (const [pId, renewedAt] of grp.firstRenewals) {
          const created = policyCreatedAt.get(pId);
          if (created) {
            durations.push((renewedAt.getTime() - created.getTime()) / (1000 * 60 * 60));
          }
        }
        if (durations.length > 0) {
          groupAvgHours = durations.reduce((a, b) => a + b, 0) / durations.length;
        }
      }

      return {
        policyType: pg.policyType,
        region: pg.region,
        renewalCount: groupRenewals,
        totalPolicies: groupPolicies,
        renewalRate: groupPolicies > 0 ? groupRenewals / groupPolicies : 0,
        avgTimeToRenewalHours: groupAvgHours,
      };
    });

    return {
      renewalRate,
      totalRenewals,
      totalPolicies,
      lapsedCount,
      avgTimeToRenewalHours,
      byGroup,
      cachedAt: new Date().toISOString(),
    };
  }

  async getSupportAnalytics(): Promise<SupportAnalytics> {
    const slaHours = this.config.get<number>('SUPPORT_SLA_HOURS', 24);
    const stats = await this.supportService.getFirstResponseStats(slaHours);
    return {
      ...stats,
      cachedAt: new Date().toISOString(),
    };
  }

  async getPolicyAnalytics(tenantId?: string): Promise<PolicyAnalytics> {
    const cacheKey = tenantId
      ? `${POLICIES_CACHE_KEY_PREFIX}:${tenantId}`
      : POLICIES_CACHE_KEY_PREFIX;

    const cached = await this.redis.get<PolicyAnalytics>(cacheKey);
    if (cached) return cached;

    const result = await this.computePolicyAnalytics(tenantId);
    await this.redis.set(cacheKey, result, POLICIES_CACHE_TTL);
    return result;
  }

  private async computePolicyAnalytics(tenantId?: string): Promise<PolicyAnalytics> {
    const where = tenantId ? { deletedAt: null, tenantId } : { deletedAt: null };

    const policies = await this.prisma.policy.findMany({
      where,
      select: { coverageAmount: true, isActive: true, policyType: true, region: true },
    });

    const totalPolicies = policies.length;
    const activePolicies = policies.filter((p) => p.isActive).length;

    // Group policies by dimensions and bucket coverage amounts
    const breakdown = new Map<string, number>();
    for (const policy of policies) {
      const bucket = this.bucketCoverageAmount(policy.coverageAmount);
      const key = `${policy.policyType}|${policy.region}|${bucket}|${policy.isActive}`;
      breakdown.set(key, (breakdown.get(key) ?? 0) + 1);
    }

    const breakdownArray: PolicyAnalyticsBreakdown[] = Array.from(breakdown.entries()).map(
      ([key, count]) => {
        const [policyType, region, coverageAmountBucket, isActive] = key.split('|');
        return {
          policyType,
          region,
          coverageAmountBucket,
          isActive: isActive === 'true',
          count,
        };
      },
    );

    return {
      totalPolicies,
      activePolicies,
      breakdown: breakdownArray,
      cachedAt: new Date().toISOString(),
    };
  }

  private bucketCoverageAmount(amount: string): string {
    const num = BigInt(amount);
    const k = BigInt(1000) * BigInt(10000000); // 1K stroops (7 decimals)
    const m = BigInt(1000000) * BigInt(10000000); // 1M stroops

    if (num < k) return '< 1k';
    if (num < BigInt(10) * k) return '1k - 10k';
    if (num < BigInt(100) * k) return '10k - 100k';
    if (num < m) return '100k - 1m';
    if (num < BigInt(10) * m) return '1m - 10m';
    return '> 10m';
  }

  async invalidatePolicyAnalyticsCache(tenantId?: string): Promise<void> {
    const cacheKey = tenantId
      ? `${POLICIES_CACHE_KEY_PREFIX}:${tenantId}`
      : POLICIES_CACHE_KEY_PREFIX;
    await this.redis.del(cacheKey);
  }
}
