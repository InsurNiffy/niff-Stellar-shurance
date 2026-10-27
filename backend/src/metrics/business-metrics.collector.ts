import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ClaimStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MetricsService } from "./metrics.service";

const RESOLVED_STATUSES: ClaimStatus[] = [
  ClaimStatus.APPROVED,
  ClaimStatus.PAID,
  ClaimStatus.REJECTED,
  ClaimStatus.APPEAL_APPROVED,
  ClaimStatus.APPEAL_REJECTED,
];

/**
 * Refreshes business KPI metrics from the database.
 *
 * Claim counters are derived from table totals so they stay correct across
 * restarts and horizontally scaled replicas.
 */
@Injectable()
export class BusinessMetricsCollector {
  private readonly logger = new Logger(BusinessMetricsCollector.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async collect(): Promise<void> {
    try {
      const [filed, resolved, activePolicies] = await Promise.all([
        this.prisma.claim.count({ where: { deletedAt: null } }),
        this.prisma.claim.groupBy({
          by: ["status"],
          where: { deletedAt: null, status: { in: RESOLVED_STATUSES } },
          _count: { _all: true },
        }),
        this.prisma.policy.count({
          where: { isActive: true, deletedAt: null },
        }),
      ]);

      this.metrics.claimsFiledTotal.reset();
      this.metrics.claimsFiledTotal.inc(filed);

      this.metrics.claimsResolvedTotal.reset();
      for (const row of resolved) {
        this.metrics.claimsResolvedTotal.inc(
          { status: row.status },
          row._count._all,
        );
      }

      this.metrics.activePoliciesGauge.set(activePolicies);
    } catch (err) {
      this.logger.warn(
        `Business metrics refresh failed: ${(err as Error).message}`,
      );
    }
  }
}
