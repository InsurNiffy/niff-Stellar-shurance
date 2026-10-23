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

  /** Get the appropriate client for reads — replica if enabled, otherwise primary. */
  private getReadClient() {
    return this.prismaReplica.isEnabled() ? this.prismaReplica : this.prisma;
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

    const comment = await this.prisma.claimComment.create({
      data: {
        claimId,
        authorAddress: walletAddress.toLowerCase(),
        body: trimmed,
      },
    });

    const dto = this.toCommentDto(comment);
    await this.publishCommentEvent('created', dto);
    return dto;
  }

  /**
   * DELETE /v1/claims/:id/comments/:commentId — the author within the edit
   * window, or a moderator at any time.
   */
  async deleteClaimComment(
    claimId: number,
    commentId: number,
    walletAddress: string,
    isModerator = false,
  ): Promise<void> {
    const comment = await this.prisma.claimComment.findFirst({
      where: { id: commentId, claimId, deletedAt: null },
    });
    if (!comment) {
      throw new NotFoundException(`Comment with ID ${commentId} not found`);
    }

    const isAuthor = comment.authorAddress.toLowerCase() === walletAddress.toLowerCase();
    if (!isModerator) {
      if (!isAuthor) {
        throw new ForbiddenException('Only the author or a moderator may delete this comment');
      }
      const age = Date.now() - comment.createdAt.getTime();
      if (age > CLAIM_COMMENT_EDIT_WINDOW_MS) {
        throw new ForbiddenException('The comment edit window has expired');
      }
    }

    await this.prisma.claimComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });

    await this.publishCommentEvent('deleted', this.toCommentDto({ ...comment, reportedAt: comment.reportedAt ?? null }));
  }

  /**
   * Serve pre-computed aggregation metrics (#1622) for the claim detail
   * endpoint. Falls back to a live computation when no snapshot exists yet
   * (e.g. a freshly created claim before the scheduled job has run).
   */
  private async resolveAggregation(claimId: number) {
    const snapshot = await this.aggregation.getSnapshot(claimId);
    if (snapshot) {
      return snapshot;
    }
    return this.aggregation.computeForClaim(claimId);
  }

  private async publishCommentEvent(
    action: 'created' | 'deleted',
    comment: ClaimCommentDto,
  ): Promise<void> {
    try {
      await this.redis.publish(CLAIM_COMMENT_EVENT_CHANNEL, {
        action,
        comment,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to publish claim comment event: ${(err as Error).message}`,
      );
    }
  }
}
