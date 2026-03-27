import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { SorobanService } from '../rpc/soroban.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../cache/redis.service';
import { SanitizationService } from './sanitization.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { claimTenantWhere, assertTenantOwnership } from '../tenant/tenant-filter.helper';
import {
  ClaimDetailResponseDto,
  ClaimMetadataDto,
  ClaimsListResponseDto,
  ConsistencyMetadataDto,
  DeadlineDto,
  QuorumProgressDto,
  SanitizedEvidenceDto,
  VoteTalliesDto,
} from './dto/claim.dto';
import {
  buildKeysetWhere,
  buildNextCursor,
  clampLimit,
} from '../helpers/pagination';

interface ListClaimsParams {
  after?: string;
  limit?: number;
  status?: string;
}

const VOTE_WINDOW_LEDGERS = 120_960;
const SECONDS_PER_LEDGER = 5;

type ClaimWithVotes = Prisma.ClaimGetPayload<{
  include: {
    votes: { select: { vote: true } };
  };
}>;

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);
  private readonly cacheTtl: number;
  private readonly ipfsGateway: string;
  private readonly maxAcceptableLag = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sanitization: SanitizationService,
    private readonly config: ConfigService,
    private readonly soroban: SorobanService,
    private readonly tenantCtx: TenantContextService,
  ) {
    this.cacheTtl = this.config.get<number>('CACHE_TTL_SECONDS', 60);
    this.ipfsGateway = this.config.get<string>('IPFS_GATEWAY', 'https://ipfs.io');
  }

  async listClaims(params: ListClaimsParams): Promise<ClaimsListResponseDto> {
    const { after, status } = params;
    const limit = clampLimit(params.limit);
    const tenantId = this.tenantCtx.tenantId;
    const cacheKey = `claims:list:${tenantId ?? 'global'}:${after ?? 'start'}:${limit}:${status ?? 'all'}`;
    const cached = await this.redis.get<ClaimsListResponseDto>(cacheKey);

    if (cached) {
      this.logger.debug(`Cache hit for ${cacheKey}`);
      return cached;
    }

    const lastLedger = await this.getLastLedger();
    const statusFilter = status
      ? { status: status.toUpperCase() as 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED' }
      : {};
    const keysetWhere = buildKeysetWhere(after);
    const where: Prisma.ClaimWhereInput = claimTenantWhere(tenantId, {
      ...statusFilter,
      ...(keysetWhere ?? {}),
    });

    const [claims, total] = await Promise.all([
      this.prisma.claim.findMany({
        where,
        include: { votes: { select: { vote: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
      this.prisma.claim.count({ where: claimTenantWhere(tenantId, statusFilter) }),
    ]);

    const response: ClaimsListResponseDto = {
      data: claims.map((claim) => this.transformClaim(claim, lastLedger)),
      pagination: {
        next_cursor: buildNextCursor(claims, limit, total),
        total,
      },
    };

    await this.redis.set(cacheKey, response, this.cacheTtl);
    return response;
  }

  async getClaimsNeedingVote(
    walletAddress: string,
    params: ListClaimsParams,
  ): Promise<ClaimsListResponseDto> {
    const { after } = params;
    const limit = clampLimit(params.limit);
    const tenantId = this.tenantCtx.tenantId;
    const lastLedger = await this.getLastLedger();

    const votedClaimIds = await this.prisma.vote.findMany({
      where: { voterAddress: walletAddress.toLowerCase() },
      select: { claimId: true },
    });
    const votedIds = votedClaimIds.map((v) => v.claimId);
    const keysetWhere = buildKeysetWhere(after);

    const baseWhere: Prisma.ClaimWhereInput = claimTenantWhere(tenantId, {
      status: 'PENDING',
      ...(votedIds.length > 0 ? { id: { notIn: votedIds } } : {}),
    });

    const [allOpen, page] = await Promise.all([
      this.prisma.claim.count({ where: baseWhere }),
      this.prisma.claim.findMany({
        where: { ...baseWhere, ...(keysetWhere ?? {}) },
        include: { votes: { select: { vote: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
    ]);

    const openClaims = page.filter(
      (claim) => this.getVotingDeadlineLedger(claim.createdAtLedger) > lastLedger,
    );

    return {
      data: openClaims.map((claim) => this.transformClaim(claim, lastLedger)),
      pagination: {
        next_cursor: buildNextCursor(openClaims, limit, allOpen),
        total: allOpen,
      },
    };
  }

  async getClaimById(id: number, walletAddress?: string): Promise<ClaimDetailResponseDto> {
    const tenantId = this.tenantCtx.tenantId;
    const cacheKey = `claims:detail:${tenantId ?? 'global'}:${id}`;
    const cached = await this.redis.get<ClaimDetailResponseDto>(cacheKey);

    if (cached && !walletAddress) {
      this.logger.debug(`Cache hit for ${cacheKey}`);
      return cached;
    }

    const lastLedger = await this.getLastLedger();
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: {
        votes: {
          select: { vote: true },
        },
      },
    });

    // Enforce tenant ownership — returns 404 for cross-tenant reads
    assertTenantOwnership(claim, tenantId, `Claim ${id}`);

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }

    const response = this.transformClaim(claim, lastLedger);

    if (!walletAddress) {
      await this.redis.set(cacheKey, response, this.cacheTtl);
      return response;
    }

    return this.enrichWithUserVote(response, walletAddress);
  }

  private async getLastLedger(): Promise<number> {
    const indexerState = await this.prisma.indexerState.findFirst({
      orderBy: { lastLedger: 'desc' },
    });
    return indexerState?.lastLedger || 0;
  }

  private transformClaim(claim: ClaimWithVotes, lastLedger: number): ClaimDetailResponseDto {
    const yesVotes = claim.votes.filter((vote) => vote.vote === 'APPROVE').length;
    const noVotes = claim.votes.filter((vote) => vote.vote === 'REJECT').length;
    const totalVotes = yesVotes + noVotes;
    const votingDeadlineLedger = this.getVotingDeadlineLedger(claim.createdAtLedger);
    const votingDeadlineTime = new Date(
      claim.createdAt.getTime() + VOTE_WINDOW_LEDGERS * SECONDS_PER_LEDGER * 1000,
    );
    const isOpen = votingDeadlineLedger > lastLedger;
    const remainingSeconds = isOpen
      ? (votingDeadlineLedger - lastLedger) * SECONDS_PER_LEDGER
      : undefined;
    const requiredVotes = Math.max(1, Math.floor(totalVotes / 2) + 1);
    const sanitizedHash = this.sanitization.sanitizeIpfsHash(
      this.extractEvidenceHash(claim.imageUrls),
    );
    const indexerLag = Math.max(0, lastLedger - claim.updatedAtLedger);

    return {
      metadata: {
        id: claim.id,
        policyId: claim.policyId,
        creatorAddress: this.sanitization.sanitizeWalletAddress(claim.creatorAddress),
        status: claim.status.toLowerCase() as 'pending' | 'approved' | 'paid' | 'rejected',
        amount: claim.amount,
        description: claim.description
          ? this.sanitization.sanitizeDescription(claim.description)
          : undefined,
        evidenceHash: sanitizedHash,
        createdAtLedger: claim.createdAtLedger,
        createdAt: claim.createdAt,
        updatedAt: claim.updatedAt,
      } as ClaimMetadataDto,
      votes: {
        yesVotes,
        noVotes,
        totalVotes,
      } as VoteTalliesDto,
      quorum: {
        required: requiredVotes,
        current: totalVotes,
        percentage: Math.min(100, Math.round((totalVotes / requiredVotes) * 100)),
        reached: claim.isFinalized || Math.max(yesVotes, noVotes) >= requiredVotes,
      } as QuorumProgressDto,
      deadline: {
        votingDeadlineLedger,
        votingDeadlineTime,
        isOpen,
        remainingSeconds,
      } as DeadlineDto,
      evidence: {
        gatewayUrl: sanitizedHash ? `${this.ipfsGateway}/ipfs/${sanitizedHash}` : '',
        hash: sanitizedHash,
      } as SanitizedEvidenceDto,
      consistency: {
        isFinalized: claim.isFinalized,
        indexerLag,
        lastIndexedLedger: lastLedger,
        isStale: indexerLag > this.maxAcceptableLag,
      } as ConsistencyMetadataDto,
    };
  }

  private getVotingDeadlineLedger(createdAtLedger: number): number {
    return createdAtLedger + VOTE_WINDOW_LEDGERS;
  }

  private extractEvidenceHash(imageUrls: string[]): string {
    for (const imageUrl of imageUrls) {
      const directHash = this.sanitization.sanitizeIpfsHash(imageUrl);
      if (directHash) {
        return directHash;
      }

      const match = imageUrl.match(/\/ipfs\/([^/?#]+)/i);
      if (match?.[1]) {
        return match[1];
      }
    }

    return '';
  }

  private async enrichWithUserVote(
    claim: ClaimDetailResponseDto,
    walletAddress: string,
  ): Promise<ClaimDetailResponseDto> {
    const userVote = await this.prisma.vote.findFirst({
      where: {
        claimId: claim.metadata.id,
        voterAddress: walletAddress.toLowerCase(),
      },
    });

    if (userVote) {
      claim.userHasVoted = true;
      claim.userVote = userVote.vote === 'APPROVE' ? 'yes' : 'no';
    }

    return claim;
  }

  async invalidateCache(claimId?: number): Promise<void> {
    if (claimId) {
      await this.redis.del(`claims:detail:${claimId}`);
    }
    await this.redis.delPattern('claims:list:*');
    this.logger.log(`Cache invalidated for claim ${claimId || 'all'}`);
  }

  /**
   * Build an unsigned file_claim transaction
   */
  async buildTransaction(args: {
    holder: string;
    policyId: number;
    amount: bigint;
    details: string;
    imageUrls: string[];
  }) {
    return this.soroban.buildFileClaimTransaction(args);
  }

  /**
   * Submit a signed transaction
   */
  async submitTransaction(transactionXdr: string) {
    const result = await this.soroban.submitTransaction(transactionXdr);
    
    // Invalidate claims list cache so the new claim appears
    await this.invalidateCache();
    
    return result;
  }
}
