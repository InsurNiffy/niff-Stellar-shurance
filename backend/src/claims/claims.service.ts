import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { SorobanService } from '../rpc/soroban.service';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaReplicaService } from '../prisma/prisma-replica.service';
import { RedisService } from '../cache/redis.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { claimTenantWhere, assertTenantOwnership } from '../tenant/tenant-filter.helper';
import { ReconciliationService } from '../indexer/reconciliation.service';
import { ClaimAggregationService } from './services/claim-aggregation.service';
import { VetSpecializationValidator } from './services/vet-specialization.validator';
import { ClaimSummaryCacheService } from './services/claim-summary-cache.service';
import { MetricsService } from '../metrics/metrics.service';
import { AuditService } from '../admin/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ClaimDetailResponseDto,
  ClaimsListResponseDto,
} from './dto/claim.dto';
import { ClaimVoterDto } from './dto/claim-voter.dto';
import {
  buildKeysetWhere,
  buildNextCursor,
  clampLimit,
} from '../helpers/pagination';
import { ClaimViewMapper } from './claim-view.mapper';
import { AppealSimulationCacheService } from './services/appeal-simulation-cache.service';

/** In-app notification type for appeal-round voter fan-out (#1321). */
const APPEAL_ROUND_NOTIFICATION_TYPE = 'appeal_round_open';
const APPEAL_ROUND_NOTIFICATION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Claim discussion comments (#1493). */
export const CLAIM_COMMENT_MAX_LENGTH = 2000;
export const CLAIM_COMMENT_EDIT_WINDOW_MS = 10 * 60 * 1000;

/** Claim statuses for which discussion comments are closed. */
const CLOSED_CLAIM_STATUSES = ['APPROVED', 'PAID', 'REJECTED'];

/** In-app notification type for new claim comments (#1493). */
const CLAIM_COMMENT_NOTIFICATION_TYPE = 'claim_comment';

/** Live event stream channel for claim comments (#1493). */
const CLAIM_COMMENT_EVENT_CHANNEL = 'claims:comments';

export interface ListClaimsParams {
  after?: string;
  limit?: number;
  status?: string;
  severity?: string;
  policyId?: string;
  search?: string;
}

export interface ClaimCommentDto {
  id: number;
  claimId: number;
  authorAddress: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  reported: boolean;
}

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);
  private readonly cacheTtl: number;
  private readonly indexerNetwork: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaReplica: PrismaReplicaService,
    private readonly redis: RedisService,
    private readonly claimViewMapper: ClaimViewMapper,
    private readonly config: ConfigService,
    private readonly soroban: SorobanService,
    private readonly tenantCtx: TenantContextService,
    private readonly reconciliation: ReconciliationService,
    private readonly aggregation: ClaimAggregationService,
    private readonly claimSummaryCache: ClaimSummaryCacheService,
    private readonly metrics: MetricsService,
    private readonly appealSimulationCache: AppealSimulationCacheService,
    private readonly vetSpecializationValidator: VetSpecializationValidator,
  ) {
    this.cacheTtl = this.config.get<number>('CACHE_TTL_SECONDS', 60);
    this.indexerNetwork = this.config.get<string>('STELLAR_NETWORK', 'testnet');
  }

  /**
   * Reject a claim filing when it requires a specialization that no registered
   * vet provides. Mirrors the contract-side `VetNotFound` check.
   */
  async assertVetSpecializationAvailable(
    requiredSpecialization: string | null | undefined,
  ): Promise<void> {
    if (!requiredSpecialization) {
      return;
    }
    const found = await this.vetSpecializationValidator.hasVetWithSpecialization(
      requiredSpecialization,
    );
    if (!found) {
      throw new NotFoundException(
        `VetNotFound: no registered vet with specialization '${requiredSpecialization}'`,
      );
    }
  }

  /** Build an unsigned `escalate_claim` transaction for the admin wallet to sign. */
  async buildEscalateClaimTransaction(
    admin: string,
    claimId: number,
    newDeadlineLedger: number,
  ): Promise<{ claimId: number; unsignedXdr: string }> {
    await this.getClaimById(claimId);
    const { unsignedXdr } = await this.soroban.buildEscalateClaimTransaction({
      admin,
      claimId,
      newDeadlineLedger,
    });
    return { claimId, unsignedXdr };
  }

  /**
   * Build an unsigned `file_claim` transaction for the claimant wallet to sign.
   * Mirrors the contract-side `file_claim` entry point (#1814).
   */
  async buildFileClaimTransaction(
    claimant: string,
    policyId: string,
    amount: string,
    description: string,
  ): Promise<{ unsignedXdr: string }> {
    if (!claimant || !policyId) {
      throw new BadRequestException('claimant and policyId are required');
    }
    const { unsignedXdr } = await this.soroban.buildFileClaimTransaction({
      claimant,
      policyId,
      amount,
      description,
    });
    return { unsignedXdr };
  }

  /** Get the appropriate client for reads — replica if enabled, otherwise primary. */
  private getReadClient() {
    return this.prismaReplica.isEnabled() ? this.prismaReplica : this.prisma;
  }

  /**
   * GET /v1/claims — tenant-scoped, cursor-paginated list with filters
   * (status, severity, policyId, free-text search) (#1814).
   */
  async listClaims(params: ListClaimsParams): Promise<ClaimsListResponseDto> {
    const limit = clampLimit(params.limit);
    const tenantId = this.tenantCtx.tenantId;

    const filters: Prisma.ClaimWhereInput = {};
    if (params.status) {
      filters.status = params.status as Prisma.ClaimWhereInput['status'];
    }
    if (params.severity) {
      filters.severity = params.severity as Prisma.ClaimWhereInput['severity'];
    }
    if (params.policyId) {
      filters.policyId = params.policyId;
    }
    if (params.search) {
      const term = params.search.trim();
      if (term) {
        filters.OR = [
          { description: { contains: term, mode: 'insensitive' } },
          { claimantAddress: { contains: term, mode: 'insensitive' } },
        ];
      }
    }

    const where = claimTenantWhere(tenantId, filters);
    const keysetWhere = buildKeysetWhere(params.after);
    const combinedWhere: Prisma.ClaimWhereInput = keysetWhere
      ? { AND: [where, keysetWhere] }
      : where;

    const rows = await this.getReadClient().claim.findMany({
      where: combinedWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? buildNextCursor(page[page.length - 1]) : null;

    return {
      items: page.map((row) => this.claimViewMapper.toSummary(row)),
      nextCursor,
    };
  }

  /**
   * GET /v1/claims/:id — tenant-scoped detail enriched with pre-computed
   * governance fields from ClaimAggregationService (#1814).
   */
  async getClaimById(id: number): Promise<ClaimDetailResponseDto> {
    const claim = await this.getReadClient().claim.findFirst({
      where: claimTenantWhere(this.tenantCtx.tenantId, { id }),
    });
    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }

    const governance = await this.aggregation.getGovernanceFields(id);

    return {
      ...this.claimViewMapper.toDetail(claim),
      quorum_progress_pct: governance.quorumProgressPct,
      votes_needed: governance.votesNeeded,
      deadline_estimate_utc: governance.deadlineEstimateUtc,
    };
  }

  /**
   * Discussion comments are closed once the claim is finalized. Appeal rounds
   * reopen discussion: while an appeal is pending the claim is still PENDING,
   * so comments remain open until the appeal is resolved.
   */
  private assertCommentsOpen(claim: { status: string }): void {
    if (CLOSED_CLAIM_STATUSES.includes(claim.status)) {
      throw new BadRequestException(
        'Discussion comments are closed for finalized claims',
      );
    }
  }

  /** Only the claimant and snapshotted voters may post comments. */
  private async assertCanComment(claimId: number, walletAddress: string): Promise<void> {
    const address = walletAddress.toLowerCase();
    const claim = await this.prisma.claim.findFirst({
      where: claimTenantWhere(this.tenantCtx.tenantId, { id: claimId }),
      select: { claimantAddress: true },
    });
    if (!claim) {
      throw new NotFoundException(`Claim with ID ${claimId} not found`);
    }
    if (claim.claimantAddress?.toLowerCase() === address) {
      return;
    }
    const vote = await this.prisma.vote.findFirst({
      where: { claimId, voterAddress: address, deletedAt: null },
      select: { id: true },
    });
    if (!vote) {
      throw new ForbiddenException(
        'Only the claimant and snapshotted voters may comment on this claim',
      );
    }
  }

  private toCommentDto(comment: {
    id: number;
    claimId: number;
    authorAddress: string;
    body: string;
    createdAt: Date;
    updatedAt: Date;
    reportedAt: Date | null;
  }): ClaimCommentDto {
    return {
      id: comment.id,
      claimId: comment.claimId,
      authorAddress: comment.authorAddress,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
      reported: comment.reportedAt !== null,
    };
  }

  /** GET /v1/claims/:id/comments — anyone may read. */
  async listClaimComments(claimId: number): Promise<ClaimCommentDto[]> {
    const claim = await this.getReadClient().claim.findFirst({
      where: claimTenantWhere(this.tenantCtx.tenantId, { id: claimId }),
      select: { id: true },
    });
    if (!claim) {
      throw new NotFoundException(`Claim with ID ${claimId} not found`);
    }
    const comments = await this.getReadClient().claimComment.findMany({
      where: { claimId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return comments.map((c) => this.toCommentDto(c));
  }

  /** POST /v1/claims/:id/comments — claimant and snapshotted voters only. */
  async createClaimComment(
    claimId: number,
    walletAddress: string,
    body: string,
  ): Promise<ClaimCommentDto> {
    const trimmed = (body ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('Comment body must not be empty');
    }
    if (trimmed.length > CLAIM_COMMENT_MAX_LENGTH) {
      throw new BadRequestException(
        `Comment body must be at most ${CLAIM_COMMENT_MAX_LENGTH} characters`,
      );
    }

    const claim = await this.prisma.claim.findFirst({
      where: claimTenantWhere(this.tenantCtx.tenantId, { id: claimId }),
      select: { id: true, status: true },
    });
    if (!claim) {
      throw new NotFoundException(`Claim with ID ${claimId} not found`);
    }
    this.assertCommentsOpen(claim);
    await this.assertCanComment(claimId, walletAddress);

    const created = await this.prisma.claimComment.create({
      data: {
        claimId,
        authorAddress: walletAddress.toLowerCase(),
        body: trimmed,
      },
    });
    return this.toCommentDto(created);
  }
}
