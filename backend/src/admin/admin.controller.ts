import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Logger,
  ParseIntPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, ArrayNotEmpty, Matches, IsIn } from 'class-validator';
import { ClaimSeverity } from '@prisma/client';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from './guards/admin-role.guard';
import { MinAdminRole } from './decorators/admin.decorator';
import { AdminService } from './admin.service';
import { AdminPoliciesService } from './admin-policies.service';
import { AdminClaimsExportService } from './admin-claims-export.service';
import { AuditService } from './audit.service';
import { ReindexDto } from './dto/reindex.dto';
import { BackfillDto } from './dto/backfill.dto';
import { AuditQueryDto } from './dto/audit-query.dto';
import { BulkFeatureFlagDto, FeatureFlagDto } from './dto/feature-flag.dto';
import { SetRateLimitDto, EnableOverrideDto } from './dto/rate-limit.dto';
import { PrivacyService, PrivacyRequestType } from '../maintenance/privacy.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { QueueMonitorService } from '../queues/queue-monitor.service';
import { SolvencyMonitoringService } from '../maintenance/solvency-monitoring.service';
import { AdminTenantsService } from './admin-tenants.service';
import { AdminStatsService } from './admin-stats.service';
import { AdminAnalyticsService } from './admin-analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../rpc/soroban.service';
import { TokenBlacklistService } from '../auth/token-blacklist.service';
import { SupportService } from '../support/support.service';
import { CommentRepository } from '../claims/comments/comment.repository';
import { TenantConfigAuditService } from '../tenant/tenant-config-audit.service';
import { TenantConfigAuditHistoryDto } from '../tenant/dto/tenant-config-audit.dto';

class BatchRegisterVotersDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Matches(/^G[A-Z2-7]{55}$/, { each: true, message: 'Each voter must be a valid Stellar public key (G...)' })
  voters!: string[];
}

class RemoveVoterDto {
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, { message: 'voter must be a valid Stellar public key (G...)' })
  voter!: string;
}

class SetQuorumBpsDto {
  @IsInt()
  @Min(1)
  @Max(10000)
  bps!: number;
}

class PrivacyRequestDto {
  @IsString() subjectWalletAddress!: string;
  @IsEnum(['ANONYMIZE', 'DELETE']) requestType!: PrivacyRequestType;
  @IsOptional() @IsString() notes?: string;
}

class SetClaimSeverityDto {
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  severity!: ClaimSeverity;
}

class RevokeTokenDto {
  @IsString() jti!: string;
  @IsInt() expiresAt!: number;
}

class AdminDeleteCommentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

class AssignTicketDto {
  @IsOptional() @IsString() assignee?: string | null;
}

type AdminRequest = Request & {
  user?: {
    walletAddress?: string;
    scope?: string;
    scopes?: string[];
  };
  adminIdentity?: {
    staffId?: string;
    email?: string;
    role?: string;
    scopes?: string[];
  };
};

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly adminService: AdminService,
    private readonly adminPoliciesService: AdminPoliciesService,
    private readonly adminClaimsExportService: AdminClaimsExportService,
    private readonly auditService: AuditService,
    private readonly privacyService: PrivacyService,
    private readonly rateLimitService: RateLimitService,
    private readonly queueMonitor: QueueMonitorService,
    private readonly configService: ConfigService,
    private readonly solvencyMonitoringService: SolvencyMonitoringService,
    private readonly tenantsService: AdminTenantsService,
    private readonly adminStatsService: AdminStatsService,
    private readonly adminAnalyticsService: AdminAnalyticsService,
    private readonly prisma: PrismaService,
    private readonly sorobanService: SorobanService,
    private readonly tokenBlacklist: TokenBlacklistService,
    private readonly supportService: SupportService,
    private readonly commentRepository: CommentRepository,
    private readonly tenantConfigAuditService: TenantConfigAuditService,
  ) {}

  // ── Governance: Voters ────────────────────────────────────────────

  /**
   * GET /admin/governance/voters
   *
   * List all registered voters from the local tracking table.
   */
  @Get('governance/voters')
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'List registered voters' })
  async listVoters() {
    return this.prisma.registeredVoter.findMany({
      orderBy: { registeredAt: 'desc' },
    });
  }

  /**
   * POST /admin/governance/voters/batch-register
   *
   * Build an unsigned batch_register_voter transaction for the given voters.
   * Returns the unsigned XDR for admin wallet signing.
   */
  @Post('governance/voters/batch-register')
  @ApiOperation({ summary: 'Build batch voter registration transaction' })
  async batchRegisterVoters(@Body() dto: BatchRegisterVotersDto, @Req() req: AdminRequest) {
    const admin = req.user?.walletAddress ?? '';
    const result = await this.sorobanService.buildBatchRegisterVotersTransaction({
      admin,
      voters: dto.voters,
    });

    await this.auditService.write({
      actor: admin,
      action: 'governance_voters_batch_register',
      payload: { voterCount: dto.voters.length, voters: dto.voters },
      ipAddress: req.ip,
    });

    return result;
  }

  /**
   * POST /admin/governance/voters/remove
   *
   * Build an unsigned remove_voter transaction for a single voter.
   * Returns the unsigned XDR for admin wallet signing.
   */
  @Post('governance/voters/remove')
  @ApiOperation({ summary: 'Build remove voter transaction' })
  async removeVoter(@Body() dto: RemoveVoterDto, @Req() req: AdminRequest) {
    const admin = req.user?.walletAddress ?? '';
    const result = await this.sorobanService.buildRemoveVoterTransaction({
      admin,
      voter: dto.voter,
    });

    await this.auditService.write({
      actor: admin,
      action: 'governance_voters_remove',
      payload: { voter: dto.voter },
      ipAddress: req.ip,
    });

    return result;
  }

  // ── Governance: Quorum ────────────────────────────────────────────

  /**
   * GET /admin/governance/quorum
   *
   * Returns the current quorum_bps value from the contract (via simulation).
   */
  @Get('governance/quorum')
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'Get current quorum_bps value' })
  async getQuorum() {
    const result = await this.sorobanService.simulateGetQuorumBps();
    return { quorum_bps: result };
  }

  /**
   * POST /admin/governance/quorum
   *
   * Build an unsigned admin_set_quorum_bps transaction.
   * Returns the unsigned XDR for admin wallet signing.
   */
  @Post('governance/quorum')
  @ApiOperation({ summary: 'Build set quorum_bps transaction' })
  async setQuorum(@Body() dto: SetQuorumBpsDto, @Req() req: AdminRequest) {
    const admin = req.user?.walletAddress ?? '';
    const result = await this.sorobanService.buildSetQuorumBpsTransaction({
      admin,
      bps: dto.bps,
    });

    await this.auditService.write({
      actor: admin,
      action: 'governance_quorum_update',
      payload: { bps: dto.bps },
      ipAddress: req.ip,
    });

    return result;
  }

  /**
   * GET /admin/governance/quorum/impact
   *
   * Returns the number of active (non-finalized) claims that would be
   * affected by changing quorum_bps to the given value.
   */
  @Get('governance/quorum/impact')
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'Preview impact of quorum change on active claims' })
  async getQuorumImpact(@Query('bps') bps?: string) {
    const targetBps = bps ? parseInt(bps, 10) : null;
    if (targetBps !== null && (isNaN(targetBps) || targetBps < 1 || targetBps > 10000)) {
      throw new BadRequestException('bps must be between 1 and 10000');
    }

    const activeClaims = await this.prisma.claim.findMany({
      where: { isFinalized: false, deletedAt: null },
      include: { votes: true },
    });

    const impacted = await Promise.all(activeClaims.map(async (claim) => {
      const eligibleVoters = claim.approveVotes + claim.rejectVotes;
      const currentRequired = Math.max(1, Math.floor(eligibleVoters / 2) + 1);
      const newRequired = targetBps !== null
        ? Math.max(1, Math.floor((eligibleVoters * targetBps) / 10000))
        : currentRequired;
      return {
        claimId: claim.id,
        currentQuorumBps: 5000,
        newQuorumBps: targetBps ?? 5000,
        eligibleVoters,
        currentRequired,
        newRequired,
        status: claim.status,
      };
    }));

    return {
      totalActiveClaims: activeClaims.length,
      affectedClaims: impacted.filter(i => i.currentRequired !== i.newRequired),
      quorumBps: targetBps,
    };
  }

  /**
   * GET /admin/users
   *
   * Lists all holder profiles ordered by lastSeenAt descending.
   * Useful for dormant account detection: accounts with null or stale
   * lastSeenAt have not made an authenticated call in the tracked window.
   *
   * Supports optional query params:
   *   - dormantDays (number): only return users not seen in X days
   *   - limit (number, default 100, max 500)
   *   - cursor (walletAddress): keyset pagination
   */
  @Get('users')
  @ApiOperation({ summary: 'List holder profiles with last-active timestamp for dormant account detection' })
  async listUsers(
    @Query('dormantDays') dormantDays?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const take = Math.min(Number(limit) || 100, 500);
    const where: Record<string, unknown> = {};
    if (dormantDays) {
      const days = parseInt(dormantDays, 10);
      if (!isNaN(days) && days > 0) {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        where['OR'] = [
          { lastSeenAt: null },
          { lastSeenAt: { lt: cutoff } },
        ];
      }
    }
    return this.prisma.holderProfile.findMany({
      where,
      orderBy: [{ lastSeenAt: 'desc' }, { walletAddress: 'asc' }],
      take,
      ...(cursor ? { skip: 1, cursor: { walletAddress: cursor } } : {}),
      select: {
        walletAddress: true,
        displayName: true,
        email: true,
        locale: true,
        createdAt: true,
        lastSeenAt: true,
      },
    });
  }

  /**
   * GET /admin/stats
   *
   * Aggregated platform metrics: policy counts, claim counts by status,
   * treasury balance (from Redis solvency snapshot), and indexer lag.
   * Response is cached in Redis with a short TTL (default: 30s).
   */
  @Get('stats')
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'Aggregated platform metrics (cached)' })
  async getStats(@Req() req: AdminRequest) {
    const tenantId = (req as unknown as { tenantId?: string }).tenantId;
    return this.adminStatsService.getStats(tenantId);
  }

  /**
   * POST /admin/reindex
   *
   * Enqueues an async reindex job starting from the given ledger sequence.
   * Returns a jobId so operators can track progress via the queue dashboard.
   *
   * Requires: admin role + valid JWT.
   * Writes an immutable audit row with actor and full payload.
   */
  @Post('reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Enqueue a ledger reindex job from a given ledger' })
  async reindex(@Body() dto: ReindexDto, @Req() req: AdminRequest) {
    const actor = req.user?.walletAddress ?? 'unknown';
    const network =
      dto.network ?? this.configService.get<string>('STELLAR_NETWORK', 'testnet');
    const jobId = await this.adminService.enqueueReindex(dto.fromLedger, network);
    await this.auditService.write({
      actor,
      action: 'reindex',
      payload: { fromLedger: dto.fromLedger, network, jobId },
      ipAddress: req.ip,
    });
    return { jobId, fromLedger: dto.fromLedger, network, status: 'queued' };
  }

  /**
   * POST /admin/indexer/backfill
   *
   * Validates the ledger range, splits it into batches, and enqueues one
   * BullMQ backfill job per batch. Rejects ranges that exceed
   * MAX_BACKFILL_LEDGER_RANGE before any jobs are created.
   *
   * Idempotent: the underlying indexer uses upsert logic so replaying
   * already-processed ledgers does not create duplicate records.
   */
  @Post('indexer/backfill')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Enqueue backfill jobs for a ledger range' })
  async enqueueBackfill(@Body() dto: BackfillDto, @Req() req: AdminRequest) {
    if (dto.fromLedger > dto.toLedger) {
      throw new BadRequestException('fromLedger must be <= toLedger');
    }
    const maxRange = this.configService.get<number>('MAX_BACKFILL_LEDGER_RANGE', 100_000);
    const range = dto.toLedger - dto.fromLedger + 1;
    if (range > maxRange) {
      throw new BadRequestException(
        `Ledger range ${range} exceeds MAX_BACKFILL_LEDGER_RANGE (${maxRange})`,
      );
    }
    const network = dto.network ?? this.configService.get<string>('STELLAR_NETWORK', 'testnet');
    const batchSize = this.configService.get<number>('INDEXER_BATCH_SIZE', 50);
    const jobs = await this.adminService.enqueueBackfill(
      dto.fromLedger,
      dto.toLedger,
      network,
      batchSize,
    );
    const actor = req.user?.walletAddress ?? 'unknown';
    await this.auditService.write({
      actor,
      action: 'indexer_backfill',
      payload: { fromLedger: dto.fromLedger, toLedger: dto.toLedger, network, jobCount: jobs.length },
      ipAddress: req.ip,
    });
    return { jobs, fromLedger: dto.fromLedger, toLedger: dto.toLedger, network, batchSize, status: 'queued' };
  }

  /**
   * GET /admin/indexer/backfill/:jobId
   *
   * Returns the current BullMQ state of a backfill job.
   */
  @Get('indexer/backfill/:jobId')
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'Get backfill job status' })
  async getBackfillJob(@Param('jobId') jobId: string) {
    const job = await this.adminService.getBackfillJob(jobId);
    if (!job) {
      throw new NotFoundException(`Backfill job ${jobId} not found`);
    }
    return job;
  }

  /**
   * GET /admin/audits
   *
   * Cursor-paginated, filterable read of the immutable admin audit log.
   * Logs each access as a meta-audit entry.
   * Requires: admin role + valid JWT.
   */
  @Get('audits')
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'Cursor-paginated admin audit log with filters' })
  async getAudits(@Query() query: AuditQueryDto, @Req() req: AdminRequest) {
    const actor = req.user?.walletAddress ?? 'unknown';
    // Meta-audit: log this access
    await this.auditService.write({
      actor,
      action: 'audit_log_read',
      payload: { cursor: query.cursor, limit: query.limit, action: query.action, actor: query.actor, from: query.from, to: query.to } as Prisma.InputJsonObject,
      ipAddress: req.ip,
    });
    return this.auditService.findAll(query);
  }

  /**
   * GET /admin/audits/export
   *
   * Streaming CSV export of the audit log for the given filters.
   * Logs each export as a meta-audit entry.
   * Requires: admin role + valid JWT.
   */
  @Get('audits/export')
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'Streaming CSV export of the audit log' })
  async exportAudits(
    @Query() query: AuditQueryDto,
    @Req() req: AdminRequest,
    @Res() res: Response,
  ) {
    const actor = req.user?.walletAddress ?? 'unknown';
    await this.auditService.write({
      actor,
      action: 'audit_log_export',
      payload: { action: query.action, actor: query.actor, from: query.from, to: query.to } as Prisma.InputJsonObject,
      ipAddress: req.ip,
    });
    await this.auditService.streamCsv(
      { action: query.action, actor: query.actor, from: query.from, to: query.to },
      res,
    );
  }

  /**
   * GET /admin/claims/export?status=PENDING&from=2024-01-01&to=2024-12-31
   *
   * Streaming CSV export of claims matching filters.
   * Rate limited: one export per minute per admin.
   *
   * CSV Columns:
   * id, policyId, creatorAddress, amount, asset, description, status, severity,
   * isFinalized, approveVotes, rejectVotes, paidAt, createdAt, updatedAt, txHash, tenantId
   *
   * Query Parameters:
   * - status: filter by claim status (PENDING, APPROVED, PAID, REJECTED)
   * - from: ISO 8601 start date (inclusive)
   * - to: ISO 8601 end date (inclusive)
   */
  @Get('claims/export')
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'Streaming CSV export of claims with pagination (no memory load)' })
  async exportClaims(
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const admin = req.user?.walletAddress ?? 'unknown';
    const rateLimitKey = `admin_claims_export:${admin}`;

    const isAllowed = await this.rateLimitService.checkLimit(rateLimitKey, 1, 60);
    if (!isAllowed) {
      throw new BadRequestException({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Claims export is limited to one per minute per admin.',
      });
    }

    await this.auditService.write({
      actor: admin,
      action: 'claims_export',
      payload: { status, from, to } as Prisma.InputJsonObject,
      ipAddress: req.ip,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=claims-export.csv');
    res.setHeader('Transfer-Encoding', 'chunked');

    const stream = this.adminClaimsExportService.createClaimsExportStream({ status, from, to });
    stream.pipe(res);
  }

  /**
   * GET /admin/policies
   *
   * Indexed policies. Omit soft-deleted rows unless `include_deleted=true`.
   */
  @Get('policies')
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'List indexed policies (optional include_deleted for compliance)' })
  async getAdminPolicies(@Query('include_deleted') includeDeleted?: string) {
    const inc = includeDeleted === 'true' || includeDeleted === '1';
    return this.adminPoliciesService.listPolicies(inc);
  }

  /**
   * DELETE /admin/policies/:holder/:policyId
   *
   * Soft-delete: sets `deleted_at` on policy, its claims, and their votes.
   * Does not remove `raw_events` (reindex integrity).
   */
  @Delete('policies/:holder/:policyId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a policy and dependent claims/votes' })
  async softDeletePolicy(
    @Param('holder') holder: string,
    @Param('policyId') policyIdParam: string,
    @Req() req: AdminRequest,
  ) {
    const policyId = Number(policyIdParam);
    if (!Number.isFinite(policyId) || policyId < 0) {
      throw new BadRequestException('policyId must be a non-negative number');
    }
    const result = await this.adminPoliciesService.softDeletePolicy(holder, policyId);
    if (!result) {
      throw new NotFoundException(`Policy ${holder}:${policyId} not found`);
    }
    const actor = req.user?.walletAddress ?? 'unknown';
    await this.auditService.write({
      actor,
      action: 'policy_soft_delete',
      payload: {
        policyKey: result.id,
        deletedAt: result.deletedAt,
        alreadyDeleted: result.alreadyDeleted,
      },
      ipAddress: req.ip,
    });
    return result;
  }

  /**
   * GET /admin/feature-flags
   *
   * Lists all feature flags and their current state.
   */
  @Get('feature-flags')
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'List all feature flags' })
  async listFeatureFlags() {
    return this.adminService.getFeatureFlags();
  }

  /**
   * POST /admin/feature-flags
   *
   * Creates a new feature flag. Key must be in the predefined allowlist.
   * Writes an immutable audit row.
   */
  @Post('feature-flags')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new feature flag (allowlisted keys only)' })
  async createFeatureFlag(@Body() dto: FeatureFlagDto & { key: string }, @Req() req: AdminRequest) {
    const actor = req.user?.walletAddress ?? 'unknown';
    const flag = await this.adminService.createFeatureFlag(dto.key, dto.enabled, dto.description, actor);
    await this.auditService.write({
      actor,
      action: 'feature_flag_create',
      payload: { key: dto.key, enabled: dto.enabled, description: dto.description },
      ipAddress: req.ip,
    });
    return flag;
  }

  /**
   * POST /admin/feature-flags/bulk
   *
   * Applies an array of {key, enabled} updates atomically within a single DB
   * transaction. All keys must be in the predefined allowlist — the request is
   * rejected in full if any key is unknown. One audit row is written for the
   * entire batch.
   */
  @Post('feature-flags/bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk-update feature flags atomically (allowlisted keys only)' })
  async bulkSetFeatureFlags(@Body() dto: BulkFeatureFlagDto, @Req() req: AdminRequest) {
    const actor = req.user?.walletAddress ?? 'unknown';
    const results = await this.adminService.bulkSetFeatureFlags(dto.updates, actor);
    await this.auditService.write({
      actor,
      action: 'feature_flag_bulk_update',
      payload: {
        updates: dto.updates as unknown as Prisma.InputJsonValue,
        count: dto.updates.length,
      },
      ipAddress: req.ip,
    });
    return { updated: results };
  }

  /**
   * GET /admin/solvency
   *
   * Latest snapshot from Redis only (no live Soroban call). Populated by the
   * scheduled solvency job; may be null before the first successful run.
   */
  @Get('solvency')
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'Cached solvency snapshot for dashboard (Redis only)' })
  async getSolvencySnapshot() {
    const snapshot = await this.solvencyMonitoringService.getLatestSnapshot();
    return { snapshot };
  }

  /**
   * PATCH /admin/feature-flags/:key
   *
   * Toggles a feature flag on or off.
   * Writes an immutable audit row with actor and full payload.
   *
   * Legal note: disabling flags that gate user-facing activity (e.g. claim
   * filing, policy creation) constitutes a staff-initiated pause of user
   * operations. Such actions must be authorised by a designated compliance
   * officer and are subject to applicable insurance-regulation obligations.
   * The audit row created here serves as the immutable record of that action.
   */
  /** POST /admin/privacy/requests — execute anonymization or deletion for a subject. */
  @Post('privacy/requests')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Submit a privacy request (anonymize or delete off-chain data)' })
  async submitPrivacyRequest(@Body() dto: PrivacyRequestDto, @Req() req: Request) {
    const actor = (req.user as { walletAddress?: string })?.walletAddress ?? 'unknown';
    return this.privacyService.handleRequest({
      subjectWalletAddress: dto.subjectWalletAddress,
      requestType: dto.requestType,
      requestedBy: actor,
      ipAddress: req.ip,
      notes: dto.notes,
    });
  }

  /** GET /admin/privacy/requests — list all privacy requests. */
  @Get('privacy/requests')
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'List privacy requests' })
  async listPrivacyRequests(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.privacyService.listRequests(Number(page), Number(limit));
  }

  @Patch('feature-flags/:key')
  @ApiOperation({ summary: 'Set a feature flag value' })
  async setFeatureFlag(
    @Param('key') key: string,
    @Body() dto: FeatureFlagDto,
    @Req() req: AdminRequest,
  ) {
    const actor = req.user?.walletAddress ?? 'unknown';
    const flag = await this.adminService.setFeatureFlag(key, dto.enabled, dto.description, actor);
    await this.auditService.write({
      actor,
      action: 'feature_flag_update',
      payload: { key, enabled: dto.enabled, description: dto.description },
      ipAddress: req.ip,
    });
    return flag;
  }

  /**
   * POST /admin/rate-limits/:policyId
   *
   * Set custom rate limit for a policy.
   * Writes an immutable audit row with actor and full payload.
   */
  @Post('rate-limits/:policyId')
  @ApiOperation({ summary: 'Set custom rate limit for a policy' })
  async setRateLimit(
    @Param('policyId') policyId: string,
    @Body() dto: SetRateLimitDto,
    @Req() req: AdminRequest,
  ) {
    const actor = req.user?.walletAddress ?? 'unknown';
    await this.rateLimitService.setLimit(policyId, dto.limit, actor);
    await this.auditService.write({
      actor,
      action: 'rate_limit_set',
      payload: { policyId, limit: dto.limit },
      ipAddress: req.ip,
    });
    return { policyId, limit: dto.limit, status: 'updated' };
  }

  /**
   * GET /admin/rate-limits/:policyId
   *
   * Get rate limit status for a policy.
   */
  @Get('rate-limits/:policyId')
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'Get rate limit status for a policy' })
  async getRateLimitStatus(@Param('policyId') policyId: string) {
    return this.rateLimitService.getCounterState(policyId);
  }

  /**
   * POST /admin/rate-limits/:policyId/override
   *
   * Enable manual override for a policy during catastrophic events.
   * Writes an immutable audit row with actor and full payload.
   */
  @Post('rate-limits/:policyId/override')
  @ApiOperation({ summary: 'Enable manual override for a policy' })
  async enableOverride(
    @Param('policyId') policyId: string,
    @Body() dto: EnableOverrideDto,
    @Req() req: AdminRequest,
  ) {
    const actor = req.user?.walletAddress ?? 'unknown';
    await this.rateLimitService.enableOverride(policyId, actor, dto.reason);
    await this.auditService.write({
      actor,
      action: 'rate_limit_override_enabled',
      payload: { policyId, reason: dto.reason },
      ipAddress: req.ip,
    });
    return { policyId, overrideActive: true };
  }

  /**
   * DELETE /admin/rate-limits/:policyId/override
   *
   * Disable manual override for a policy.
   * Writes an immutable audit row with actor and full payload.
   */
  @Delete('rate-limits/:policyId/override')
  @ApiOperation({ summary: 'Disable manual override for a policy' })
  async disableOverride(
    @Param('policyId') policyId: string,
    @Req() req: AdminRequest,
  ) {
    const actor = req.user?.walletAddress ?? 'unknown';
    await this.rateLimitService.disableOverride(policyId, actor);
    await this.auditService.write({
      actor,
      action: 'rate_limit_override_disabled',
      payload: { policyId },
      ipAddress: req.ip,
    });
    return { policyId, overrideActive: false };
  }

  /** POST /admin/queues/:queue/jobs/:jobId/retry — replay a DLQ job */
  @Post('queues/:queue/jobs/:jobId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Replay a failed (DLQ) job by id' })
  async retryDlqJob(
    @Param('queue') queue: string,
    @Param('jobId') jobId: string,
    @Req() req: AdminRequest,
  ) {
    const actor = req.user?.walletAddress ?? 'unknown';
    await this.queueMonitor.replayJob(queue, jobId);
    await this.auditService.write({
      actor,
      action: 'dlq_job_replayed',
      payload: { queue, jobId },
      ipAddress: req.ip,
    });
    return { queue, jobId, status: 'retried' };
  }

  /**
   * GET /admin/analytics/renewals
   *
   * Renewal rate, lapsed count, and average time-to-renewal grouped by policy type
   * and region. Response is cached in Redis with a 10-minute TTL.
   */
  @Get('analytics/renewals')
  @ApiOperation({ summary: 'Renewal analytics grouped by policy type and region (10-min cache)' })
  async getRenewalAnalytics() {
    return this.adminAnalyticsService.getRenewalAnalytics();
  }

  /**
   * GET /admin/analytics/support
   *
   * Average first-response time and SLA breach count for support tickets.
   */
  @Get('analytics/support')
  @ApiOperation({ summary: 'Support ticket first-response and SLA analytics' })
  async getSupportAnalytics() {
    return this.adminAnalyticsService.getSupportAnalytics();
  }

  /**
   * GET /admin/analytics/policies
   *
   * Aggregated policy statistics by policyType, region, coverageAmount bucket,
   * and isActive. Response is cached in Redis with a 5-minute TTL.
   */
  @Get('analytics/policies')
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'Policy analytics grouped by type, region, and coverage (5-min cache)' })
  async getPolicyAnalytics(@Req() req: AdminRequest) {
    const tenantId = req.user?.scope ?? (req.adminIdentity?.scopes?.[0] ?? undefined);
    return this.adminAnalyticsService.getPolicyAnalytics(tenantId);
  }

  /**
   * GET /admin/claims/search
   *
   * Search claims with full-text search and filtering.
   * Supports: q (text search), status, severity, claimant, policyId, dateFrom, dateTo
   * Returns cursor-paginated results with total count.
   */
  @Get('claims/search')
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'Search claims with filters and full-text search' })
  async searchClaims(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('claimant') claimant?: string,
    @Query('policyId') policyId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('after') after?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.searchClaims({
      q,
      status,
      severity,
      claimant,
      policyId,
      dateFrom,
      dateTo,
      after,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /**
   * PATCH /admin/claims/:id/severity
   *
   * Set the triage severity level (LOW/MEDIUM/HIGH/CRITICAL) on a claim.
   * Writes an immutable audit row.
   */
  @Patch('claims/:id/severity')
  @ApiOperation({ summary: 'Set triage severity on a claim' })
  async setClaimSeverity(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetClaimSeverityDto,
    @Req() req: AdminRequest,
  ) {
    const claim = await this.prisma.claim.findFirst({ where: { id, deletedAt: null } });
    if (!claim) throw new NotFoundException(`Claim ${id} not found`);

    const updated = await this.prisma.claim.update({
      where: { id },
      data: { severity: dto.severity },
    });

    const actor = req.user?.walletAddress ?? 'unknown';
    await this.auditService.write({
      actor,
      action: 'claim_severity_set',
      payload: { claimId: id, severity: dto.severity },
      ipAddress: req.ip,
    });

    return { claimId: id, severity: updated.severity };
  }

  /**
   * GET /admin/claims/:id/comments
   *
   * List all comments for a claim, including soft-deleted ones (admin view).
   */
  @Get('claims/:id/comments')
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'List all comments for a claim including soft-deleted (admin view)' })
  async listClaimCommentsAdmin(@Param('id', ParseIntPipe) claimId: number) {
    return this.commentRepository.findAll(claimId);
  }

  /**
   * DELETE /admin/claims/:id/comments/:commentId
   *
   * Admin soft-delete of a comment. Records an audit log entry with the reason.
   */
  @Delete('claims/:id/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Admin soft-delete a claim comment with audit log' })
  async adminDeleteComment(
    @Param('id', ParseIntPipe) claimId: number,
    @Param('commentId') commentId: string,
    @Body() dto: AdminDeleteCommentDto,
    @Req() req: AdminRequest,
  ): Promise<void> {
    const comment = await this.commentRepository.findById(commentId);
    if (!comment || comment.deletedAt !== null) {
      throw new NotFoundException('Comment not found');
    }
    await this.commentRepository.softDelete(commentId);
    const actor = req.user?.walletAddress ?? 'unknown';
    await this.auditService.write({
      actor,
      action: 'admin_delete_comment',
      payload: { commentId, claimId, reason: dto.reason ?? null },
      ipAddress: req.ip,
    });
  }

  /**
   * GET /admin/policies/export
   *
   * Stream policies as CSV with optional filtering.
   * Supports: status, holderAddress, policyType, dateFrom, dateTo
   * Returns streaming CSV response.
   */
  @Get('policies/export')
  @ApiOperation({ summary: 'Export policies as CSV with filters' })
  async exportPolicies(
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('holderAddress') holderAddress?: string,
    @Query('policyType') policyType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const actor = req.user?.walletAddress ?? 'unknown';

    // Write audit log entry
    await this.auditService.write({
      actor,
      action: 'policies_exported',
      payload: { status, holderAddress, policyType, dateFrom, dateTo },
      ipAddress: req.ip,
    });

    // Generate CSV
    const csv = await this.adminService.exportPoliciesCSV({
      status,
      holderAddress,
      policyType,
      dateFrom,
      dateTo,
    });

    // Stream response
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="policies.csv"');
    res.send(csv);
  }

  // ── #929 Evidence limits ───────────────────────────────────────────────────

  /**
   * GET /admin/governance/evidence-limits
   *
   * Reads min_evidence_count and max_evidence_count from the contract via
   * Soroban simulation. Requires SOLVENCY_SIMULATION_SOURCE_ACCOUNT to be set.
   */
  @Get('governance/evidence-limits')
  @ApiOperation({ summary: 'Read evidence count limits from the contract (simulation)' })
  async getEvidenceLimits() {
    const source =
      this.configService.get<string>('SOLVENCY_SIMULATION_SOURCE_ACCOUNT') ||
      this.configService.get<string>('CLAIM_KEEPER_SOURCE_ACCOUNT');
    if (!source) {
      throw new BadRequestException({
        code: 'SIMULATION_SOURCE_NOT_CONFIGURED',
        message: 'SOLVENCY_SIMULATION_SOURCE_ACCOUNT is not set.',
      });
    }
    return this.sorobanService.simulateGetEvidenceLimits({ sourceAccount: source });
  }

  /**
   * PATCH /admin/governance/evidence-limits
   *
   * Updates min_evidence_count and max_evidence_count on-chain.
   * Validation: min >= 0, max > 0, min <= max.
   * Writes an immutable audit row.
   */
  @Patch('governance/evidence-limits')
  @ApiOperation({ summary: 'Update evidence count limits on-chain' })
  async setEvidenceLimits(
    @Body() body: { min: number; max: number },
    @Req() req: AdminRequest,
  ) {
    const min = Number(body.min);
    const max = Number(body.max);
    if (!Number.isInteger(min) || min < 0) {
      throw new BadRequestException('min must be a non-negative integer');
    }
    if (!Number.isInteger(max) || max <= 0) {
      throw new BadRequestException('max must be a positive integer');
    }
    if (min > max) {
      throw new BadRequestException('min must not exceed max');
    }
    const result = await this.sorobanService.invokeAdminSetEvidenceLimits({ min, max });
    const actor = req.user?.walletAddress ?? 'unknown';
    await this.auditService.write({
      actor,
      action: 'admin_set_evidence_limits',
      payload: { min, max, txHash: result.txHash },
      ipAddress: req.ip,
    });
    return result;
  }

  // ── Auth: Token Management ─────────────────────────────────────────

  /**
   * POST /admin/auth/revoke
   *
   * Revoke a JWT token immediately by adding to Redis blacklist.
   * Token remains blacklisted until its expiry time.
   */
  @Post('auth/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a JWT token' })
  async revokeToken(@Body() dto: RevokeTokenDto, @Req() req: AdminRequest) {
    if (!dto.jti || dto.jti.length === 0) {
      throw new BadRequestException('jti must be a non-empty string');
    }
    if (!Number.isInteger(dto.expiresAt) || dto.expiresAt <= 0) {
      throw new BadRequestException('expiresAt must be a positive integer (Unix timestamp)');
    }

    await this.tokenBlacklist.revokeToken(dto.jti, dto.expiresAt);

    const actor = req.adminIdentity?.staffId || req.adminIdentity?.email || 'unknown';
    await this.auditService.write({
      actor,
      action: 'auth_token_revoke',
      payload: { jti: dto.jti },
      ipAddress: req.ip,
    });
  }

  // ── Support: Ticket Management ─────────────────────────────────────

  /**
   * GET /admin/support/tickets
   *
   * List all support tickets with optional filtering.
   */
  @Get('support/tickets')
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'List support tickets' })
  async listSupportTickets(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('assignedTo') assignedTo?: string,
  ) {
    return this.supportService.listTickets(limit || 50, offset || 0, assignedTo);
  }

  /**
   * PATCH /admin/support/tickets/:id/assign
   *
   * Assign a support ticket to a staff member or unassign it.
   */
  @Patch('support/tickets/:id/assign')
  @ApiOperation({ summary: 'Assign support ticket to staff member' })
  async assignSupportTicket(
    @Param('id') ticketId: string,
    @Body() dto: AssignTicketDto,
    @Req() req: AdminRequest,
  ) {
    const actor = req.adminIdentity?.staffId || req.adminIdentity?.email || 'unknown';
    return this.supportService.assignTicket(ticketId, dto.assignee ?? null, actor, req.ip);
  }

  // ── Tenant Config Audit ────────────────────────────────────────────

  /**
   * GET /admin/tenants/:tenantId/config-audit
   *
   * Retrieve the configuration change audit history for a tenant.
   * Returns entries in chronological order (oldest first).
   * Supports optional filtering by config key and actor.
   * Pagination via limit (default 50) and offset (default 0).
   */
  @Get('tenants/:tenantId/config-audit')
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'Retrieve tenant configuration change audit history' })
  async getTenantConfigAuditHistory(
    @Param('tenantId') tenantId: string,
    @Query('key') key?: string,
    @Query('actor') actor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<TenantConfigAuditHistoryDto> {
    const { entries, total } = await this.tenantConfigAuditService.getAuditHistory({
      tenantId,
      key,
      actor,
      limit: limit || 50,
      offset: offset || 0,
    });

    return {
      entries,
      total,
      count: entries.length,
    };
  }
}
