import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
  ) {
    this.cacheTtl = this.config.get<number>('CACHE_TTL_SECONDS', 60);
    this.indexerNetwork = this.config.get<string>('STELLAR_NETWORK', 'testnet');
  }

  /** Get the appropriate client for reads — replica if enabled, otherwise primary. */
  private getReadClient() {
    return this.prismaReplica.isEnabled() ? this.prismaReplica : this.prisma;
  }

  async listClaims(params: ListClaimsParams): Promise<ClaimsListResponseDto> {
    const { after, status } = params;
    const limit = clampLimit(params.limit);
    const tenantId = this.tenantCtx.tenantId;
    const cacheKey = this.claimSummaryCache.key({ tenantId, after, limit, status });

    return this.claimSummaryCache.getOrCompute(cacheKey, async () => {
      this.logger.debug(`Claim summary cache miss for ${cacheKey}`);

      const lastLedger = await this.getLastLedger();
      const statusFilter = status
        ? { status: status.toUpperCase() as 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED' }
        : {};
      const keysetWhere = buildKeysetWhere(after);
      const where: Prisma.ClaimWhereInput = claimTenantWhere(tenantId, {
        ...statusFilter,
        ...(keysetWhere ?? {}),
      });

      const readClient = this.getReadClient();
      const [claims, total] = await Promise.all([
        readClient.claim.findMany({
          where,
          include: {
            votes: { where: { deletedAt: null }, select: { vote: true } },
            evidenceMetadata: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit,
        }),
        readClient.claim.count({ where: claimTenantWhere(tenantId, statusFilter) }),
      ]);

      return {
        data: await Promise.all(
          claims.map(async (claim) => {
            const agg = await this.aggregation.aggregate(claim.id, lastLedger);
            return this.claimViewMapper.transformClaim(claim, lastLedger, {
              quorum_progress_pct: agg.quorum_progress_pct,
              votes_needed: agg.votes_needed,
              deadline_estimate_utc: agg.deadline_estimate_utc,
            });
          }),
        ),
        pagination: {
          next_cursor: buildNextCursor(claims, limit, total),
          total,
        },
      };
    });
  }

  async getClaimsNeedingVote(
    walletAddress: string,
    params: ListClaimsParams,
  ): Promise<ClaimsListResponseDto> {
    const { after } = params;
    const limit = clampLimit(params.limit);
    const tenantId = this.tenantCtx.tenantId;
    const lastLedger = await this.getLastLedger();

    const readClient = this.getReadClient();
    const votedClaimIds = await readClient.vote.findMany({
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
      readClient.claim.count({ where: baseWhere }),
      readClient.claim.findMany({
        where: { ...baseWhere, ...(keysetWhere ?? {}) },
        include: {
          votes: { where: { deletedAt: null }, select: { vote: true } },
          evidenceMetadata: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
    ]);

    const openClaims = page.filter(
      (claim) => this.claimViewMapper.getVotingDeadlineLedger(claim.createdAtLedger) > lastLedger,
    );

    return {
      data: await Promise.all(
        openClaims.map(async (claim) => {
          const agg = await this.aggregation.aggregate(claim.id, lastLedger);
          return this.claimViewMapper.transformClaim(claim, lastLedger, {
            quorum_progress_pct: agg.quorum_progress_pct,
            votes_needed: agg.votes_needed,
            deadline_estimate_utc: agg.deadline_estimate_utc,
          });
        }),
      ),
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
    const readClient = this.getReadClient();
    const claim = await readClient.claim.findFirst({
      where: claimTenantWhere(tenantId, { id }),
      include: {
        votes: {
          where: { deletedAt: null },
          select: { vote: true },
        },
        evidenceMetadata: true,
      },
    });

    // Enforce tenant ownership — returns 404 for cross-tenant reads
    assertTenantOwnership(claim, tenantId, `Claim ${id}`);

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }

    const agg = await this.aggregation.aggregate(id, lastLedger);
    const response = this.claimViewMapper.transformClaim(claim, lastLedger, {
      quorum_progress_pct: agg.quorum_progress_pct,
      votes_needed: agg.votes_needed,
      deadline_estimate_utc: agg.deadline_estimate_utc,
    });

    // Attach reconciliation status so the frontend can show a data-quality warning.
    const reconStatus = await this.reconciliation.getClaimReconciliationStatus(id);
    response.consistency.tallyReconciled = reconStatus.ok;

    if (!walletAddress) {
      await this.redis.set(cacheKey, response, this.cacheTtl);
      return response;
    }

    return this.enrichWithUserVote(response, walletAddress);
  }

  async getClaimVoters(claimId: number): Promise<ClaimVoterDto[]> {
    const readClient = this.getReadClient();
    const [registeredVoters, votes] = await Promise.all([
      readClient.registeredVoter.findMany(),
      readClient.vote.findMany({
        where: { claimId, deletedAt: null },
        select: { voterAddress: true, vote: true },
      }),
    ]);

    const voteMap = new Map<string, 'APPROVE' | 'REJECT'>();
    for (const v of votes) {
      voteMap.set(v.voterAddress.toLowerCase(), v.vote);
    }

    return registeredVoters.map((voter) => {
      const normalized = voter.walletAddress.toLowerCase();
      const dbVote = voteMap.get(normalized);
      return {
        walletAddress: voter.walletAddress,
        displayName: voter.displayName ?? undefined,
        voted: !!dbVote,
        vote: dbVote === 'APPROVE' ? 'yes' : dbVote === 'REJECT' ? 'no' : undefined,
      };
    });
  }

  /**
   * List eligible voters for the current appeal round (offline mirror of
   * on-chain snapshot_appeal_voters). Returns empty when no appeal snapshot
   * has been persisted yet.
   */
  async getAppealVoters(claimId: number): Promise<ClaimVoterDto[]> {
    const tenantId = this.tenantCtx.tenantId;
    const readClient = this.getReadClient();

    const claim = await readClient.claim.findFirst({
      where: claimTenantWhere(tenantId, { id: claimId }),
      select: { id: true, status: true, appealsCount: true },
    });

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${claimId} not found`);
    }

    if (claim.appealsCount < 1) {
      return [];
    }

    const [snapshot, registeredVoters] = await Promise.all([
      readClient.appealVoterSnapshot.findMany({
        where: { claimId, appealsCount: claim.appealsCount },
        select: { walletAddress: true },
      }),
      readClient.registeredVoter.findMany({
        select: { walletAddress: true, displayName: true },
      }),
    ]);

    const displayNameByWallet = new Map(
      registeredVoters.map((v) => [v.walletAddress.toLowerCase(), v.displayName]),
    );

    // Appeal-round vote status is not yet indexed separately from the original
    // round; surface eligibility only (voted=false) so the FE can list the electorate.
    return snapshot.map((row) => ({
      walletAddress: row.walletAddress,
      displayName:
        displayNameByWallet.get(row.walletAddress.toLowerCase()) ?? undefined,
      voted: false,
      vote: undefined,
    }));
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
    const readClient = this.getReadClient();
    const claims = await readClient.claim.findMany({
      where: claimTenantWhere(tenantId, {
        policyId: { in: uniquePolicyIds },
      }),
      include: {
        votes: {
          where: { deletedAt: null },
          select: { vote: true },
        },
        evidenceMetadata: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    for (const claim of claims) {
      const bucket = results.get(claim.policyId);
      if (!bucket || bucket.length >= limitPerPolicy) {
        continue;
      }

      const agg = await this.aggregation.aggregate(claim.id, lastLedger);
      bucket.push(this.claimViewMapper.transformClaim(claim, lastLedger, {
        quorum_progress_pct: agg.quorum_progress_pct,
        votes_needed: agg.votes_needed,
        deadline_estimate_utc: agg.deadline_estimate_utc,
      }));
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
    const normalizedWallet = walletAddress.toLowerCase();
    const tenantId = this.tenantCtx.tenantId;
    const [userVote, activePolicyCount] = await Promise.all([
      this.prisma.vote.findFirst({
        where: {
          claimId: claim.metadata.id,
          voterAddress: normalizedWallet,
          deletedAt: null,
        },
      }),
      this.prisma.policy.count({
        where: {
          holderAddress: { equals: walletAddress, mode: 'insensitive' },
          isActive: true,
          deletedAt: null,
          ...(tenantId ? { tenantId } : {}),
        },
      }),
    ]);

    if (userVote) {
      claim.userHasVoted = true;
      claim.userVote = userVote.vote === 'APPROVE' ? 'yes' : 'no';
    }

    claim.voter_eligible =
      activePolicyCount > 0 &&
      claim.deadline.isOpen &&
      !claim.consistency.isFinalized &&
      !userVote;

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
   * Store evidence metadata for a claim
   */
  async storeEvidenceMetadata(
    claimId: number,
    metadata: { cid?: string; url?: string; fileSizeBytes?: number; mimeType?: string }
  ): Promise<void> {
    const tenantId = this.tenantCtx.tenantId;

    // Verify claim exists and belongs to tenant
    const claim = await this.prisma.claim.findFirst({
      where: claimTenantWhere(tenantId, { id: claimId }),
      select: { id: true },
    });

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${claimId} not found`);
    }

    await this.prisma.evidenceMetadata.upsert({
      where: { claimId },
      create: {
        claimId,
        cid: metadata.cid,
        url: metadata.url,
        fileSizeBytes: metadata.fileSizeBytes,
        mimeType: metadata.mimeType,
      },
      update: {
        cid: metadata.cid,
        url: metadata.url,
        fileSizeBytes: metadata.fileSizeBytes,
        mimeType: metadata.mimeType,
      },
    });

    await this.invalidateCache(claimId);
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

  // ── Appeal submission ─────────────────────────────────────────────────────

  /**
   * Simulate file_appeal for a rejected claim (wallet pre-flight).
   *
   * Short-TTL Redis cache keyed by (claimId, walletAddress) avoids redundant
   * RPC on retries (#1327). Successful responses never include unsignedXdr —
   * callers that need signing material must hit buildAppealTransaction, which
   * always runs a fresh simulation.
   */
  async simulateAppealTransaction(args: {
    claimId: number;
    walletAddress: string;
    reason?: string;
  }) {
    const tenantId = this.tenantCtx.tenantId;
    const claim = await this.prisma.claim.findFirst({
      where: claimTenantWhere(tenantId, { id: args.claimId }),
      select: { id: true },
    });
    if (!claim) {
      throw new NotFoundException(`Claim with ID ${args.claimId} not found`);
    }

    const cached = await this.appealSimulationCache.get(args.claimId, args.walletAddress);
    if (cached) {
      this.logger.debug(
        `Appeal simulate cache hit claim=${args.claimId} wallet=${args.walletAddress}`,
      );
      return { ...cached, cached: true as const };
    }

    const built = await this.soroban.buildAppealTransaction({
      claimant: args.walletAddress,
      claimId: args.claimId,
      reason: args.reason?.trim() || 'Appeal simulation',
    });

    const payload = {
      ok: true as const,
      claimId: args.claimId,
      walletAddress: args.walletAddress,
      minResourceFee: built.minResourceFee,
      baseFee: built.baseFee,
      totalEstimatedFee: built.totalEstimatedFee,
      totalEstimatedFeeXlm: built.totalEstimatedFeeXlm,
      currentLedger: built.currentLedger,
    };

    await this.appealSimulationCache.set(args.claimId, args.walletAddress, payload);
    return { ...payload, cached: false as const };
  }

  /**
   * Build an unsigned file_appeal transaction for a rejected claim.
   * Always fresh RPC — never reads the appeal simulate cache (#1327).
   */
  async buildAppealTransaction(args: {
    claimant: string;
    claimId: number;
    reason: string;
  }) {
    return this.soroban.buildAppealTransaction(args);
  }

  /**
   * Submit a signed appeal transaction with idempotency protection.
   *
   * Idempotency guard (task #1329):
   *   If `txHash` was already recorded as `appealTxHash` on this claim, the DB
   *   row already reflects the appeal — return the stored result without
   *   re-incrementing `appealsCount` or recording another metric.
   *
   * @param claimId  - Numeric claim ID being appealed.
   * @param transactionXdr - Base64-encoded signed Soroban transaction envelope.
   * @param txHash   - SHA-256 hex of the signed XDR (client-supplied, used as idempotency key).
   */
  async submitAppealTransaction(
    claimId: number,
    transactionXdr: string,
    txHash: string,
  ) {
    const tenantId = this.tenantCtx.tenantId;

    // Verify the claim exists and belongs to the correct tenant
    const claim = await this.prisma.claim.findFirst({
      where: claimTenantWhere(tenantId, { id: claimId }),
      select: {
        id: true,
        status: true,
        appealTxHash: true,
        appealsCount: true,
        creatorAddress: true,
      },
    });

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${claimId} not found`);
    }

    // ── Idempotency guard ────────────────────────────────────────────────────
    // If the same signed transaction was already submitted, return without
    // double-counting. This handles the client-retry-after-timeout scenario.
    if (claim.appealTxHash === txHash) {
      this.logger.log(
        `Appeal idempotency hit for claim=${claimId} txHash=${txHash} — returning cached result`,
      );
      return {
        cached: true,
        txHash,
        claimId,
        status: claim.status,
        appealsCount: claim.appealsCount,
      };
    }

    // Submit the signed transaction to the network
    const result = await this.soroban.submitTransaction(transactionXdr);

    // Persist appeal tracking fields and set claim status to UNDER_APPEAL.
    // The indexer will later decode the appeal_approved / appeal_rejected event
    // and move the claim to APPROVED or REJECTED.
    const updated = await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: 'UNDER_APPEAL',
        appealsCount: { increment: 1 },
        appealTxHash: txHash,
      },
      select: { id: true, status: true, updatedAt: true },
    });

    // Push live status to GET /claims/status/stream subscribers (#1326).
    ClaimsService.publishStatusChange({
      claimId: String(updated.id),
      status: updated.status.toLowerCase(),
      updatedAt: updated.updatedAt.toISOString(),
    });

    // Increment appeal metrics (task #1328)
    this.metrics.recordAppealOpened();

    // Invalidate relevant caches
    await this.invalidateCache(claimId);

    this.logger.log(`Appeal submitted for claim=${claimId} txHash=${txHash}`);

    return { cached: false, txHash, claimId, ...result };
  }

  private async notifyAppealVoters(
    claimId: number,
    voterAddresses: string[],
  ): Promise<void> {
    for (const walletAddress of voterAddresses) {
      try {
        await this.notifications.createNotificationRecord({
          userId: walletAddress,
          type: APPEAL_ROUND_NOTIFICATION_TYPE,
          payload: {
            claimId,
            message: `A new appeal voting round is open for claim ${claimId}. Cast your vote.`,
          },
          ttlSeconds: APPEAL_ROUND_NOTIFICATION_TTL_SECONDS,
        });
      } catch (err) {
        this.logger.warn(
          `Failed to notify appeal voter ${walletAddress} for claim=${claimId}: ${err}`,
        );
      }
    }
  }

  private async writeAppealAudit(params: {
    actor: string;
    claimId: number;
    txHash: string;
    appealsCount: number;
  }): Promise<void> {
    try {
      await this.audit.write({
        actor: params.actor,
        action: 'appeal_submitted',
        payload: {
          claimId: params.claimId,
          txHash: params.txHash,
          appealsCount: params.appealsCount,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      this.logger.warn(`Appeal audit write failed for claim=${params.claimId}: ${err}`);
    }
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
