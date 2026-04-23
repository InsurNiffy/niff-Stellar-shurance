import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { SorobanService } from '../rpc/soroban.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../cache/redis.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { claimTenantWhere, assertTenantOwnership } from '../tenant/tenant-filter.helper';
import { ReconciliationService } from '../indexer/reconciliation.service';
import {
  ClaimDetailResponseDto,
  ClaimsListResponseDto,
} from './dto/claim.dto';
import {
  buildKeysetWhere,
  buildNextCursor,
  clampLimit,
} from '../helpers/pagination';
import { ClaimViewMapper } from './claim-view.mapper';

export interface ListClaimsParams {
  after?: string;
  limit?: number;
  status?: string;
}

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);
  private readonly cacheTtl: number;
  private readonly indexerNetwork: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly claimViewMapper: ClaimViewMapper,
    private readonly config: ConfigService,
    private readonly soroban: SorobanService,
    private readonly tenantCtx: TenantContextService,
    private readonly reconciliation: ReconciliationService,
  ) {
    this.cacheTtl = this.config.get<number>('CACHE_TTL_SECONDS', 60);
    this.indexerNetwork = this.config.get<string>('STELLAR_NETWORK', 'testnet');
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
        include: {
          votes: { where: { deletedAt: null }, select: { vote: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
      this.prisma.claim.count({ where: claimTenantWhere(tenantId, statusFilter) }),
    ]);

    const response: ClaimsListResponseDto = {
      data: claims.map((claim) => this.claimViewMapper.transformClaim(claim, lastLedger)),
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
      where: { voterAddress: walletAddress.toLowerCase(), deletedAt: null },
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
        include: {
          votes: { where: { deletedAt: null }, select: { vote: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
    ]);

    const openClaims = page.filter(
      (claim) => this.getVotingDeadlineLedger(claim.createdAtLedger) > lastLedger,
    );

    return {
      data: openClaims.map((claim) => this.claimViewMapper.transformClaim(claim, lastLedger)),
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
    const claim = await this.prisma.claim.findFirst({
      where: claimTenantWhere(tenantId, { id }),
      include: {
        votes: {
          where: { deletedAt: null },
          select: { vote: true },
        },
      },
    });

    // Enforce tenant ownership — returns 404 for cross-tenant reads
    assertTenantOwnership(claim, tenantId, `Claim ${id}`);

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }

    const response = this.claimViewMapper.transformClaim(claim, lastLedger);

    // Attach reconciliation status so the frontend can show a data-quality warning.
    const reconStatus = await this.reconciliation.getClaimReconciliationStatus(id);
    response.consistency.tallyReconciled = reconStatus.ok;

    if (!walletAddress) {
      await this.redis.set(cacheKey, response, this.cacheTtl);
      return response;
    }

    return this.enrichWithUserVote(response, walletAddress);
  }

  async getClaimsByPolicyIds(
    policyIds: readonly string[],
    limitPerPolicy: number,
  ): Promise<Map<string, ClaimDetailResponseDto[]>> {
    const tenantId = this.tenantCtx.tenantId;
    const uniquePolicyIds = [...new Set(policyIds)];
    const results = new Map<string, ClaimDetailResponseDto[]>(
      uniquePolicyIds.map((policyId) => [policyId, []]),
    );

    if (uniquePolicyIds.length === 0) {
      return results;
    }

    const lastLedger = await this.getLastLedger();
    const claims = await this.prisma.claim.findMany({
      where: claimTenantWhere(tenantId, {
        policyId: { in: uniquePolicyIds },
      }),
      include: {
        votes: {
          where: { deletedAt: null },
          select: { vote: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    for (const claim of claims) {
      const bucket = results.get(claim.policyId);
      if (!bucket || bucket.length >= limitPerPolicy) {
        continue;
      }

      bucket.push(this.claimViewMapper.transformClaim(claim, lastLedger));
    }

    return results;
  }

  private async getLastLedger(): Promise<number> {
    const cursor = await this.prisma.ledgerCursor.findUnique({
      where: { network: this.indexerNetwork },
    });
    if (cursor) {
      return cursor.lastProcessedLedger;
    }
    const legacy = await this.prisma.indexerState.findFirst({
      orderBy: { lastLedger: 'desc' },
    });
    return legacy?.lastLedger ?? 0;
  }

  private async enrichWithUserVote(
    claim: ClaimDetailResponseDto,
    walletAddress: string,
  ): Promise<ClaimDetailResponseDto> {
    const userVote = await this.prisma.vote.findFirst({
      where: {
        claimId: claim.metadata.id,
        voterAddress: walletAddress.toLowerCase(),
        deletedAt: null,
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
    evidence: { url: string; contentSha256Hex: string }[];
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

  // ── Claim status polling & SSE ───────────────────────────────────────────

  /**
   * Returns the current status for a set of claim IDs.
   * Used by the frontend polling loop (GET /api/claims/status).
   */
  async getClaimStatuses(
    claimIds: string[],
  ): Promise<{ claimId: string; status: string; updatedAt: string }[]> {
    const numericIds = claimIds.map(Number).filter((n) => !isNaN(n));
    if (numericIds.length === 0) return [];

    const tenantId = this.tenantCtx.tenantId;
    const claims = await this.prisma.claim.findMany({
      where: claimTenantWhere(tenantId, { id: { in: numericIds } }),
      select: { id: true, status: true, updatedAt: true },
    });

    return claims.map((c) => ({
      claimId: String(c.id),
      status: c.status.toLowerCase(),
      updatedAt: c.updatedAt.toISOString(),
    }));
  }

  /**
   * Subscribes a SSE client to status changes for the given claim IDs.
   * Returns an unsubscribe function to call when the client disconnects.
   *
   * Implementation: lightweight in-process pub/sub via a Map of listeners.
   * In a multi-instance deployment, replace with a Redis pub/sub channel.
   */
  subscribeToStatusChanges(
    claimIds: string[],
    send: (data: object) => void,
  ): () => void {
    const idSet = new Set(claimIds);

    const listener = (update: { claimId: string; status: string; updatedAt: string }) => {
      if (idSet.has(update.claimId)) {
        send(update);
      }
    };

    ClaimsService.statusListeners.add(listener);
    return () => ClaimsService.statusListeners.delete(listener);
  }

  /**
   * Publishes a status-change event to all active SSE subscribers.
   * Call this from the indexer or queue consumer whenever a claim status changes.
   */
  static publishStatusChange(update: {
    claimId: string;
    status: string;
    updatedAt: string;
  }): void {
    for (const listener of ClaimsService.statusListeners) {
      try {
        listener(update);
      } catch {
        // Ignore errors from individual listeners (e.g. closed connections).
      }
    }
  }

  // In-process listener registry. Replace with Redis pub/sub for multi-instance.
  private static readonly statusListeners = new Set<
    (update: { claimId: string; status: string; updatedAt: string }) => void
  >();
}
