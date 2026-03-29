import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminPoliciesService {
  private readonly logger = new Logger(AdminPoliciesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List indexed policies. Public API consumers never see soft-deleted rows;
   * staff may pass `include_deleted=true` for compliance review.
   */
  async listPolicies(includeDeleted: boolean) {
    const policies = await this.prisma.policy.findMany({
      where: includeDeleted ? {} : { deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }],
      take: 1_000,
      select: {
        id: true,
        policyId: true,
        holderAddress: true,
        policyType: true,
        region: true,
        coverageAmount: true,
        premium: true,
        isActive: true,
        startLedger: true,
        endLedger: true,
        assetContractId: true,
        tenantId: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { policies };
  }

  /**
   * Logical delete: sets `deletedAt` on the policy and all dependent claims and votes.
   * `raw_events` are not modified (reindex source of truth).
   * Idempotent if already soft-deleted.
   */
  async softDeletePolicy(holder: string, policyId: number) {
    const id = `${holder}:${policyId}`;
    const existing = await this.prisma.policy.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }
    if (existing.deletedAt) {
      return {
        id,
        deletedAt: existing.deletedAt.toISOString(),
        alreadyDeleted: true as const,
      };
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.vote.updateMany({
        where: {
          deletedAt: null,
          claim: { policyId: id },
        },
        data: { deletedAt: now },
      }),
      this.prisma.claim.updateMany({
        where: { policyId: id, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.policy.update({
        where: { id },
        data: { deletedAt: now },
      }),
    ]);

    this.logger.log(`Policy ${id} soft-deleted at ${now.toISOString()}`);
    return { id, deletedAt: now.toISOString(), alreadyDeleted: false as const };
  }
}
