import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ClaimStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const DAY_MS = 24 * 60 * 60 * 1000;
export const COMMENT_PURGE_DAYS = 90;
export const CLAIM_ARCHIVE_DAYS = 730;
const ARCHIVE_BATCH_SIZE = 500;

const RESOLVED_STATUSES: ClaimStatus[] = [
  ClaimStatus.PAID,
  ClaimStatus.REJECTED,
  ClaimStatus.APPEAL_APPROVED,
  ClaimStatus.APPEAL_REJECTED,
];

/**
 * Weekly maintenance cleanup (Sunday 03:00 UTC, off-peak):
 *  1. Hard-delete soft-deleted ClaimComment rows older than 90 days.
 *  2. Move finalized claims resolved more than 2 years ago into `claim_archive`.
 *  3. Delete feature flags whose `expiresAt` has passed.
 */
@Injectable()
export class ScheduledCleanupService {
  private readonly logger = new Logger(ScheduledCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron("0 3 * * 0", { name: "weekly-maintenance-cleanup", timeZone: "UTC" })
  async runWeeklyCleanup(): Promise<void> {
    const now = new Date();
    const comments = await this.purgeDeletedComments(now);
    const claims = await this.archiveResolvedClaims(now);
    const flags = await this.purgeExpiredFeatureFlags(now);
    this.logger.log(
      `Weekly cleanup: comments=${comments} archivedClaims=${claims} featureFlags=${flags}`,
    );
  }

  async purgeDeletedComments(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - COMMENT_PURGE_DAYS * DAY_MS);
    const { count } = await this.prisma.claimComment.deleteMany({
      where: { deletedAt: { not: null, lt: cutoff } },
    });
    return count;
  }

  async archiveResolvedClaims(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - CLAIM_ARCHIVE_DAYS * DAY_MS);
    let total = 0;

    for (;;) {
      const batch = await this.prisma.claim.findMany({
        where: {
          isFinalized: true,
          status: { in: RESOLVED_STATUSES },
          updatedAt: { lt: cutoff },
        },
        take: ARCHIVE_BATCH_SIZE,
      });
      if (batch.length === 0) break;

      const ids = batch.map((c) => c.id);
      await this.prisma.$transaction([
        this.prisma.claimArchive.createMany({
          data: batch.map((c) => ({
            id: c.id,
            policyId: c.policyId,
            status: c.status,
            amount: c.amount,
            snapshot: c as unknown as Prisma.InputJsonValue,
            resolvedAt: c.updatedAt,
          })),
          skipDuplicates: true,
        }),
        this.prisma.claim.deleteMany({ where: { id: { in: ids } } }),
      ]);
      total += batch.length;
      if (batch.length < ARCHIVE_BATCH_SIZE) break;
    }
    return total;
  }

  async purgeExpiredFeatureFlags(now: Date): Promise<number> {
    const { count } = await this.prisma.featureFlag.deleteMany({
      where: { expiresAt: { not: null, lt: now } },
    });
    return count;
  }
}
