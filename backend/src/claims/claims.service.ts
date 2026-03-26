import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../cache/redis.service';
import { SanitizationService } from './sanitization.service';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { SorobanService } from '../rpc/soroban.service';
import {
  ClaimsListResponseDto,
  ClaimDetailResponseDto,
  ClaimMetadataDto,
  VoteTalliesDto,
  QuorumProgressDto,
  DeadlineDto,
  SanitizedEvidenceDto,
  ConsistencyMetadataDto,
} from './dto/claim.dto';

interface ListClaimsParams {
  page: number;
  limit: number;
  status?: string;
}

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);
  private readonly cacheTtl: number;
  private readonly ipfsGateway: string;
  private readonly maxAcceptableLag = 5; // ledgers

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sanitization: SanitizationService,
    private readonly config: ConfigService,
    private readonly soroban: SorobanService,
  ) {
    this.cacheTtl = this.config.get<number>('CACHE_TTL_SECONDS', 60);
    this.ipfsGateway = this.config.get<string>('IPFS_GATEWAY', 'https://ipfs.io');
  }

  /**
   * List all claims with aggregated data and pagination
   * Uses optimized queries with Prisma relations
   */
  async listClaims(params: ListClaimsParams): Promise<ClaimsListResponseDto> {
    const { page, limit, status } = params;
    const skip = (page - 1) * limit;

    // Try cache first
    const cacheKey = `claims:list:${page}:${limit}:${status || 'all'}`;
    const cached = await this.redis.get<ClaimsListResponseDto>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for ${cacheKey}`);
      return cached;
    }

    // Get current ledger info for consistency
    const indexerState = await this.prisma.indexerState.findFirst({
      orderBy: { lastLedger: 'desc' },
    });
    const lastLedger = indexerState?.lastLedger || 0;

    // Build where clause
    const where = status 
      ? { status: status.toUpperCase() as 'PENDING' | 'APPROVED' | 'REJECTED' }
      : undefined;

    // Fetch claims with related data
    const [claims, total] = await Promise.all([
      this.prisma.claim.findMany({
        where,
        include: {
          votes: {
            select: { vote: true },
          },
          policy: {
            select: {
              votingDeadlineLedger: true,
              votingDeadlineTime: true,
              requiredVotes: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.claim.count({ where }),
    ]);

    // Transform to response format
    const data = claims.map((claim) => this.transformClaim(claim, lastLedger));
    
    const response: ClaimsListResponseDto = {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: skip + data.length < total,
      },
    };

    // Cache the response
    await this.redis.set(cacheKey, response, this.cacheTtl);
    return response;
  }

  /**
   * Get claims that the user has not voted on yet
   */
  async getClaimsNeedingVote(
    walletAddress: string,
    params: ListClaimsParams,
  ): Promise<ClaimsListResponseDto> {
    const { page, limit } = params;
    const skip = (page - 1) * limit;

    const indexerState = await this.prisma.indexerState.findFirst({
      orderBy: { lastLedger: 'desc' },
    });
    const lastLedger = indexerState?.lastLedger || 0;

    // Get IDs of claims user has already voted on
    const votedClaimIds = await this.prisma.vote.findMany({
      where: { voterAddress: walletAddress.toLowerCase() },
      select: { claimId: true },
    });
    const votedIds = votedClaimIds.map(v => v.claimId);

    // Get pending claims where voting is still open and user hasn't voted
    const [claims, total] = await Promise.all([
      this.prisma.claim.findMany({
        where: {
          status: 'PENDING',
          policy: {
            votingDeadlineLedger: { gt: lastLedger },
          },
          id: { notIn: votedIds.length > 0 ? votedIds : undefined },
        },
        include: {
          votes: {
            select: { vote: true },
          },
          policy: {
            select: {
              votingDeadlineLedger: true,
              votingDeadlineTime: true,
              requiredVotes: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.claim.count({
        where: {
          status: 'PENDING',
          policy: {
            votingDeadlineLedger: { gt: lastLedger },
          },
          id: { notIn: votedIds.length > 0 ? votedIds : undefined },
        },
      }),
    ]);

    const data = claims.map((claim) => this.transformClaim(claim, lastLedger));

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: skip + data.length < total,
      },
    };
  }

  /**
   * Get detailed claim view by ID
   */
  async getClaimById(id: number, walletAddress?: string): Promise<ClaimDetailResponseDto> {
    const cacheKey = `claims:detail:${id}`;
    const cached = await this.redis.get<ClaimDetailResponseDto>(cacheKey);
    
    if (cached && !walletAddress) {
      this.logger.debug(`Cache hit for ${cacheKey}`);
      return cached;
    }

    const indexerState = await this.prisma.indexerState.findFirst({
      orderBy: { lastLedger: 'desc' },
    });
    const lastLedger = indexerState?.lastLedger || 0;

    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: {
        votes: {
          select: { vote: true },
        },
        policy: {
          select: {
            votingDeadlineLedger: true,
            votingDeadlineTime: true,
            requiredVotes: true,
          },
        },
      },
    });

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }

    const response = this.transformClaim(claim, lastLedger);
    
    if (!walletAddress) {
      await this.redis.set(cacheKey, response, this.cacheTtl);
    }

    if (walletAddress) {
      return this.enrichWithUserVote(response, walletAddress);
    }

    return response;
  }

  /**
   * Transform claim to response DTO
   */
  private transformClaim(
    claim: Prisma.ClaimGetPayload<{
      include: {
        votes: { select: { vote: true } };
        policy: { 
          select: {
            votingDeadlineLedger: true;
            votingDeadlineTime: true;
            requiredVotes: true;
          }
        };
      };
    }>,
    lastLedger: number,
  ): ClaimDetailResponseDto {
    // Calculate vote tallies
    const yesVotes = claim.votes.filter(v => v.vote === 'YES').length;
    const noVotes = claim.votes.filter(v => v.vote === 'NO').length;
    const totalVotes = claim.votes.length;
    
    const currentLedger = lastLedger;
    const isOpen = claim.policy.votingDeadlineLedger > currentLedger;
    
    // Calculate remaining seconds (Stellar avg ~5 seconds per ledger)
    let remainingSeconds: number | undefined;
    if (isOpen) {
      const ledgersRemaining = claim.policy.votingDeadlineLedger - currentLedger;
      remainingSeconds = ledgersRemaining * 5;
    }

    // Calculate quorum percentage
    const requiredVotes = claim.policy.requiredVotes;
    const quorumPercentage = requiredVotes > 0 
      ? Math.min(100, Math.round((totalVotes / requiredVotes) * 100))
      : 0;

    // Sanitize evidence hash
    const sanitizedHash = this.sanitization.sanitizeIpfsHash(claim.evidenceHash || '');

    // Calculate indexer lag
    const indexerLag = lastLedger - claim.updatedAtLedger;

    return {
      metadata: {
        id: claim.id,
        policyId: claim.policyId,
        creatorAddress: this.sanitization.sanitizeWalletAddress(claim.creatorAddress),
        status: claim.status.toLowerCase() as 'pending' | 'approved' | 'rejected',
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
        percentage: quorumPercentage,
        reached: totalVotes >= requiredVotes,
      } as QuorumProgressDto,
      deadline: {
        votingDeadlineLedger: claim.policy.votingDeadlineLedger,
        votingDeadlineTime: claim.policy.votingDeadlineTime,
        isOpen,
        remainingSeconds,
      } as DeadlineDto,
      evidence: {
        gatewayUrl: `${this.ipfsGateway}/ipfs/${sanitizedHash}`,
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

  /**
   * Enrich claim with user's vote information
   */
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
      claim.userVote = userVote.vote.toLowerCase() as 'yes' | 'no';
    }

    return claim;
  }

  /**
   * Invalidate cache for a specific claim or all claims
   */
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
