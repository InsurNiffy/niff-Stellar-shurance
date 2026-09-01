import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  Post,
  HttpCode,
  HttpStatus,
  Body,
  Res,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ClaimsService } from './claims.service';
import { ClaimsListResponseDto, ClaimDetailResponseDto, ClaimTimelineEntryDto } from './dto/claim.dto';
import { ClaimVoterDto } from './dto/claim-voter.dto';
import { BuildClaimTransactionDto } from './dto/build-claim-transaction.dto';
import { SubmitTransactionDto } from './dto/submit-transaction.dto';
import { BuildAppealTransactionDto } from './dto/build-appeal-transaction.dto';
import { SubmitAppealTransactionDto } from './dto/submit-appeal-transaction.dto';
import { EvidenceUploadService } from './services/evidence-upload.service';
import { EvidenceProxyService } from './services/evidence-proxy.service';
import { ClaimHistoryService } from './services/claim-history.service';
import { EVIDENCE_MAX_BYTES_DEFAULT } from './dto/evidence-upload.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletAddress } from '../auth/decorators/wallet-address.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { ClaimRateLimitGuard } from '../rate-limit/claim-rate-limit.guard';
import { AppealRateLimitGuard } from '../rate-limit/appeal-rate-limit.guard';
import { MAX_LIMIT, DEFAULT_LIMIT } from '../helpers/pagination';
import { OptionalJwtAuthGuard } from '../tx/guards/optional-jwt.guard';
import { Feature } from '../feature-flags/feature.decorator';
import { APPEAL_FEATURE_FLAG } from './claims.constants';
import { SimulateAppealDto } from './dto/simulate-appeal.dto';

/** Maximum claim IDs accepted per status-poll or SSE subscription. */
const MAX_WATCH_IDS = 50;

@ApiTags('claims')
@Controller('claims')
export class ClaimsController {
  constructor(
    private readonly claimsService: ClaimsService,
    private readonly evidenceUploadService: EvidenceUploadService,
    private readonly evidenceProxyService: EvidenceProxyService,
    private readonly claimHistoryService: ClaimHistoryService,
  ) {}

  @Post('evidence/upload')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: undefined, // memory storage (default)
      limits: { fileSize: EVIDENCE_MAX_BYTES_DEFAULT, files: 1 },
    }),
  )
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload claim evidence file to IPFS' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'Evidence file (PDF, PNG, JPEG)' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Upload successful', schema: { type: 'object', properties: { cid: { type: 'string' }, gatewayUrl: { type: 'string' } } } })
  @ApiResponse({ status: 400, description: 'Invalid file (unsupported type, oversized, or malformed)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async uploadEvidence(
    @UploadedFile() file: Express.Multer.File,
    @WalletAddress() walletAddress: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this.evidenceUploadService.upload(file, walletAddress);
  }

  @Get()
  @ApiOperation({ summary: 'List claims with cursor-based pagination' })
  @ApiQuery({
    name: 'after',
    required: false,
    type: String,
    description: 'Opaque cursor from a previous response next_cursor. Omit for the first page.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: `Items per page. Clamped to [1, ${MAX_LIMIT}]. Default ${DEFAULT_LIMIT}.`,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'approved', 'rejected', 'paid'],
    description: 'Filter by claim status.',
  })
  @ApiResponse({ status: 200, description: 'Paginated list of claims', type: ClaimsListResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid cursor' })
  async listClaims(
    @Query('after') after?: string,
    @Query('limit', new DefaultValuePipe(DEFAULT_LIMIT), ParseIntPipe) limit?: number,
    @Query('status') status?: string,
  ): Promise<ClaimsListResponseDto> {
    return this.claimsService.listClaims({ after, limit, status });
  }

  @Get('needs-my-vote')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get claims requiring the authenticated user to vote' })
  @ApiQuery({
    name: 'after',
    required: false,
    type: String,
    description: 'Opaque cursor from a previous response next_cursor.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: `Items per page. Clamped to [1, ${MAX_LIMIT}]. Default ${DEFAULT_LIMIT}.`,
  })
  @ApiResponse({ status: 200, description: 'Claims where user has not voted yet', type: ClaimsListResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid cursor' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getClaimsNeedingMyVote(
    @WalletAddress() walletAddress: string,
    @Query('after') after?: string,
    @Query('limit', new DefaultValuePipe(DEFAULT_LIMIT), ParseIntPipe) limit?: number,
  ): Promise<ClaimsListResponseDto> {
    return this.claimsService.getClaimsNeedingVote(walletAddress, { after, limit });
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get detailed claim view' })
  @ApiResponse({ status: 200, description: 'Detailed claim with vote tallies', type: ClaimDetailResponseDto })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  async getClaim(
    @Param('id', ParseIntPipe) id: number,
    @WalletAddress() walletAddress?: string,
  ): Promise<ClaimDetailResponseDto> {
    return this.claimsService.getClaimById(id, walletAddress);
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Get chronological status-transition timeline for a claim' })
  @ApiResponse({ status: 200, description: 'Chronological status transitions', type: [ClaimTimelineEntryDto] })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  async getClaimTimeline(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ClaimTimelineEntryDto[]> {
    return this.claimHistoryService.getTimeline(id);
  }

  @Get(':id/voters')
  @ApiOperation({ summary: 'List eligible voters with vote status for a claim' })
  @ApiResponse({ status: 200, description: 'Voters with vote status', type: [ClaimVoterDto] })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  async getClaimVoters(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ClaimVoterDto[]> {
    return this.claimsService.getClaimVoters(id);
  }

  @Post(':id/evidence/metadata')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Store evidence metadata for a claim' })
  @ApiResponse({ status: 200, description: 'Metadata stored successfully' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  async storeEvidenceMetadata(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { cid?: string; url?: string; fileSizeBytes?: number; mimeType?: string }
  ): Promise<{ success: boolean }> {
    await this.claimsService.storeEvidenceMetadata(id, dto);
    return { success: true };
  }

  @Get(':id/evidence/:index')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Download claim evidence file via authenticated IPFS proxy' })
  @ApiResponse({ status: 200, description: 'Evidence file stream' })
  @ApiResponse({ status: 403, description: 'Forbidden — not the claimant, a voter, or an admin' })
  @ApiResponse({ status: 404, description: 'Claim or evidence index not found' })
  async downloadEvidence(
    @Param('id', ParseIntPipe) id: number,
    @Param('index', ParseIntPipe) index: number,
    @WalletAddress() walletAddress: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.evidenceProxyService.stream(id, index, walletAddress, res);
  }

  @Post('build-transaction')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Build unsigned file_claim transaction' })
  @ApiResponse({ status: 200, description: 'Unsigned transaction XDR + fee estimates' })
  async buildTransaction(@Body() dto: BuildClaimTransactionDto) {
    return this.claimsService.buildTransaction({
      holder: dto.holder,
      policyId: dto.policyId,
      amount: BigInt(dto.amount),
      details: dto.details,
      evidence: dto.evidence,
    });
  }

  @Post('submit')
  @UseGuards(ClaimRateLimitGuard, RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit signed claim transaction' })
  @ApiResponse({ status: 200, description: 'Transaction submitted' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async submitTransaction(@Body() dto: SubmitTransactionDto) {
    return this.claimsService.submitTransaction(dto.transactionXdr);
  }

  // ── Appeal endpoints ─────────────────────────────────────────────────────
  // Gated behind `claims_appeal_enabled` (#1355). Appeal writes use
  // AppealRateLimitGuard (#1322) — a stricter, isolated tier from claim filing.

  /**
   * POST /api/claims/:id/appeal/simulate
   *
   * Dry-runs file_appeal via Soroban simulation. Results are short-TTL Redis
   * cached by (claimId, walletAddress) so wallet retries avoid redundant RPC
   * (#1327). Never returns signing XDR — use /build-transaction for that.
   */
  @Post(':id/appeal/simulate')
  @Feature(APPEAL_FEATURE_FLAG)
  @UseGuards(OptionalJwtAuthGuard, AppealRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Simulate file_appeal (short-TTL cache; no signing XDR)' })
  @ApiResponse({ status: 200, description: 'Simulation succeeded (may be cache hit)' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async simulateAppeal(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SimulateAppealDto,
  ) {
    return this.claimsService.simulateAppealTransaction({
      claimId: id,
      walletAddress: dto.walletAddress,
      reason: dto.reason,
    });
  }

  /**
   * POST /api/claims/:id/appeal/build-transaction
   *
   * Builds an unsigned file_appeal XDR for a rejected claim.
   * Always performs a fresh RPC simulation — never served from the simulate cache (#1327).
   * The client signs the XDR with their wallet and submits it via POST ./:id/appeal.
   */
  @Post(':id/appeal/build-transaction')
  @Feature(APPEAL_FEATURE_FLAG)
  @UseGuards(JwtAuthGuard, AppealRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Build unsigned file_appeal transaction for a rejected claim' })
  @ApiResponse({ status: 200, description: 'Unsigned appeal transaction XDR + fee estimates' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async buildAppealTransaction(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BuildAppealTransactionDto,
  ) {
    return this.claimsService.buildAppealTransaction({
      claimant: dto.claimant,
      claimId: id,
      reason: dto.reason,
    });
  }

  /**
   * POST /api/claims/:id/appeal
   *
   * Submits a signed appeal transaction for a rejected claim.
   *
   * Idempotency: if `txHash` was already recorded for this claim, the cached
   * result is returned without re-submitting or double-counting the appeal.
   *
   * Rate limit: AppealRateLimitGuard (2/hour, 5/day per wallet) — see #1322.
   */
  @Post(':id/appeal')
  @Feature(APPEAL_FEATURE_FLAG)
  @UseGuards(JwtAuthGuard, AppealRateLimitGuard, RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit signed appeal transaction (idempotent by txHash)' })
  @ApiResponse({ status: 200, description: 'Appeal submitted or cached result returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async submitAppeal(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmitAppealTransactionDto,
  ) {
    return this.claimsService.submitAppealTransaction(
      id,
      dto.transactionXdr,
      dto.txHash,
    );
  }

  // ── Claim status polling (for watched claims) ────────────────────────────

  /**
   * GET /api/claims/status?claimId=1&claimId=2
   * Returns the current status for up to MAX_WATCH_IDS claim IDs.
   * Used by the frontend polling loop (useClaimWatcher).
   * Latency: indexer lag + cache TTL, typically < 30 s on Mainnet.
   */
  @Get('status')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Poll current status for a set of watched claim IDs' })
  @ApiQuery({ name: 'claimId', required: true, isArray: true, type: String })
  @ApiResponse({ status: 200, description: 'Array of { claimId, status, updatedAt }' })
  async getClaimStatuses(
    @Query('claimId') claimId: string | string[],
  ): Promise<{ claimId: string; status: string; updatedAt: string }[]> {
    const ids = (Array.isArray(claimId) ? claimId : [claimId]).slice(0, MAX_WATCH_IDS);
    if (ids.length === 0) throw new BadRequestException('At least one claimId is required.');
    return this.claimsService.getClaimStatuses(ids);
  }

  // ── SSE stream for claim status changes ──────────────────────────────────

  /**
   * GET /api/claims/status/stream?claimId=1&claimId=2
   * Server-Sent Events stream that pushes status-change events for watched claims.
   * Falls back gracefully — clients use polling if SSE is unavailable.
   * Max latency: indexer lag + push delay, typically < 15 s on Mainnet.
   */
  @Get('status/stream')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'SSE stream for watched claim status changes' })
  @ApiQuery({ name: 'claimId', required: true, isArray: true, type: String })
  @ApiResponse({ status: 200, description: 'text/event-stream' })
  streamClaimStatuses(
    @Query('claimId') claimId: string | string[],
    @Res() res: Response,
  ): void {
    const ids = (Array.isArray(claimId) ? claimId : [claimId]).slice(0, MAX_WATCH_IDS);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders();

    const send = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Send a heartbeat every 25 s to keep the connection alive through proxies.
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25_000);

    // Subscribe to status changes for the requested claim IDs.
    const unsubscribe = this.claimsService.subscribeToStatusChanges(ids, send);

    res.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }

  // ── Appeal endpoints ──────────────────────────────────────────────────────
  // These endpoints expose build/simulate/submit/status operations for the
  // appeal flow. Each error response includes a `code` field matching one of
  // the APPEAL_ERROR_MESSAGES codes; examples are provided below for every code
  // a client can receive so the generated OpenAPI spec stays in sync.

  /**
   * GET /api/claims/:id/appeal/status
   * Returns whether an appeal has already been submitted for a claim.
   */
  @Get(':id/appeal/status')
  @ApiOperation({ summary: 'Check whether an appeal has been submitted for a claim' })
  @ApiResponse({
    status: 200,
    description: 'Appeal status for the claim',
    schema: {
      type: 'object',
      properties: {
        appealSubmitted: { type: 'boolean', example: false },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Claim not found — CLAIM_NOT_FOUND',
    content: {
      'application/json': {
        examples: {
          CLAIM_NOT_FOUND: {
            summary: 'Claim not found',
            value: { code: 'CLAIM_NOT_FOUND', message: 'Claim not found.' },
          },
        },
      },
    },
  })
  async getAppealStatus(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ appealSubmitted: boolean }> {
    return this.claimsService.getAppealStatus(id);
  }

  /**
   * POST /api/claims/:id/appeal/simulate
   * Simulates the appeal transaction to pre-flight check eligibility.
   * Returns HTTP 200 on success (null body) or a 4xx with an error code.
   */
  @Post(':id/appeal/simulate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Simulate the appeal transaction (pre-flight check)' })
  @ApiResponse({ status: 200, description: 'Simulation passed — safe to open wallet popup' })
  @ApiResponse({
    status: 400,
    description: 'Simulation failed — appeal cannot proceed',
    content: {
      'application/json': {
        examples: {
          NOT_CLAIMANT: {
            summary: 'Caller is not the claimant',
            value: { code: 'NOT_CLAIMANT', message: 'Only the claimant can appeal this claim.' },
          },
          CLAIM_NOT_REJECTED: {
            summary: 'Claim is not in Rejected status',
            value: { code: 'CLAIM_NOT_REJECTED', message: 'Only rejected claims can be appealed.' },
          },
          APPEAL_ALREADY_SUBMITTED: {
            summary: 'Appeal already submitted',
            value: { code: 'APPEAL_ALREADY_SUBMITTED', message: 'An appeal has already been submitted for this claim.' },
          },
          APPEAL_WINDOW_CLOSED: {
            summary: 'Appeal filing deadline has passed',
            value: { code: 'APPEAL_WINDOW_CLOSED', message: 'The appeal window for this claim has closed.' },
          },
          CLAIMS_PAUSED: {
            summary: 'Contract admin has paused claims operations',
            value: { code: 'CLAIMS_PAUSED', message: 'Claim operations are currently paused by the contract admin.' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Claim not found — CLAIM_NOT_FOUND',
    content: {
      'application/json': {
        examples: {
          CLAIM_NOT_FOUND: {
            summary: 'Claim not found',
            value: { code: 'CLAIM_NOT_FOUND', message: 'Claim not found.' },
          },
        },
      },
    },
  })
  async simulateAppeal(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { walletAddress: string },
  ): Promise<void> {
    return this.claimsService.simulateAppeal(id, body.walletAddress);
  }

  /**
   * POST /api/claims/:id/appeal
   * Submit a signed appeal transaction for a rejected claim.
   * Opens a new voting window with elevated quorum requirements.
   */
  @Post(':id/appeal')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit a signed appeal transaction for a rejected claim' })
  @ApiResponse({
    status: 200,
    description: 'Appeal submitted — new voting window is open',
    schema: {
      type: 'object',
      properties: {
        transactionHash: { type: 'string', example: 'abc123...' },
        status: { type: 'string', example: 'UnderAppeal' },
        message: { type: 'string', example: 'Appeal submitted successfully.' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Appeal cannot be submitted',
    content: {
      'application/json': {
        examples: {
          NOT_CLAIMANT: {
            summary: 'Caller is not the claimant',
            value: { code: 'NOT_CLAIMANT', message: 'Only the claimant can appeal this claim.' },
          },
          CLAIM_NOT_REJECTED: {
            summary: 'Claim is not in Rejected status',
            value: { code: 'CLAIM_NOT_REJECTED', message: 'Only rejected claims can be appealed.' },
          },
          APPEAL_ALREADY_SUBMITTED: {
            summary: 'Appeal already submitted',
            value: { code: 'APPEAL_ALREADY_SUBMITTED', message: 'An appeal has already been submitted for this claim.' },
          },
          APPEAL_WINDOW_CLOSED: {
            summary: 'Appeal filing deadline has passed',
            value: { code: 'APPEAL_WINDOW_CLOSED', message: 'The appeal window for this claim has closed.' },
          },
          CLAIMS_PAUSED: {
            summary: 'Contract admin has paused claims operations',
            value: { code: 'CLAIMS_PAUSED', message: 'Claim operations are currently paused by the contract admin.' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Claim not found — CLAIM_NOT_FOUND',
    content: {
      'application/json': {
        examples: {
          CLAIM_NOT_FOUND: {
            summary: 'Claim not found',
            value: { code: 'CLAIM_NOT_FOUND', message: 'Claim not found.' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async submitAppeal(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { walletAddress: string; signedXdr: string },
  ): Promise<{ transactionHash: string; status: string; message: string }> {
    return this.claimsService.submitAppeal(id, body.walletAddress, body.signedXdr);
  }

  /**
   * POST /api/claims/:id/appeal/vote/simulate
   * Simulates the appeal-round vote transaction to pre-flight check eligibility.
   */
  @Post(':id/appeal/vote/simulate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Simulate an appeal-round vote (pre-flight check)' })
  @ApiResponse({ status: 200, description: 'Simulation passed — safe to open wallet popup' })
  @ApiResponse({
    status: 400,
    description: 'Appeal vote simulation failed',
    content: {
      'application/json': {
        examples: {
          NOT_ELIGIBLE_VOTER: {
            summary: 'Wallet is not in the eligible voter snapshot',
            value: { code: 'NOT_ELIGIBLE_VOTER', message: 'Your wallet is not in the eligible voter list for this appeal.' },
          },
          DUPLICATE_VOTE: {
            summary: 'Already voted in this appeal round',
            value: { code: 'DUPLICATE_VOTE', message: 'You have already cast an appeal vote on this claim.' },
          },
          VOTING_WINDOW_CLOSED: {
            summary: 'Appeal voting window has closed',
            value: { code: 'VOTING_WINDOW_CLOSED', message: 'The appeal voting window has closed.' },
          },
          CLAIM_NOT_UNDER_APPEAL: {
            summary: 'Claim is not in UnderAppeal status',
            value: { code: 'CLAIM_NOT_UNDER_APPEAL', message: 'This claim is not currently in the appeal round.' },
          },
          CLAIMS_PAUSED: {
            summary: 'Contract admin has paused claims operations',
            value: { code: 'CLAIMS_PAUSED', message: 'Claim operations are currently paused by the contract admin.' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Claim not found — CLAIM_NOT_FOUND',
    content: {
      'application/json': {
        examples: {
          CLAIM_NOT_FOUND: {
            summary: 'Claim not found',
            value: { code: 'CLAIM_NOT_FOUND', message: 'Claim not found.' },
          },
        },
      },
    },
  })
  async simulateAppealVote(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { walletAddress: string; vote: 'Approve' | 'Reject' },
  ): Promise<void> {
    return this.claimsService.simulateAppealVote(id, body.walletAddress, body.vote);
  }

  /**
   * POST /api/claims/:id/appeal/vote
   * Submit a signed vote in the appeal round for a UnderAppeal claim.
   */
  @Post(':id/appeal/vote')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit a signed vote in the appeal round' })
  @ApiResponse({
    status: 200,
    description: 'Appeal vote recorded on-chain',
    schema: {
      type: 'object',
      properties: {
        transactionHash: { type: 'string', example: 'abc123...' },
        status: { type: 'string', example: 'UnderAppeal' },
        approve_votes: { type: 'integer', example: 3 },
        reject_votes: { type: 'integer', example: 1 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Appeal vote cannot be submitted',
    content: {
      'application/json': {
        examples: {
          NOT_ELIGIBLE_VOTER: {
            summary: 'Wallet is not in the eligible voter snapshot',
            value: { code: 'NOT_ELIGIBLE_VOTER', message: 'Your wallet is not in the eligible voter list for this appeal.' },
          },
          DUPLICATE_VOTE: {
            summary: 'Already voted in this appeal round',
            value: { code: 'DUPLICATE_VOTE', message: 'You have already cast an appeal vote on this claim.' },
          },
          VOTING_WINDOW_CLOSED: {
            summary: 'Appeal voting window has closed',
            value: { code: 'VOTING_WINDOW_CLOSED', message: 'The appeal voting window has closed.' },
          },
          CLAIM_NOT_UNDER_APPEAL: {
            summary: 'Claim is not in UnderAppeal status',
            value: { code: 'CLAIM_NOT_UNDER_APPEAL', message: 'This claim is not currently in the appeal round.' },
          },
          CLAIMS_PAUSED: {
            summary: 'Contract admin has paused claims operations',
            value: { code: 'CLAIMS_PAUSED', message: 'Claim operations are currently paused by the contract admin.' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Claim not found — CLAIM_NOT_FOUND',
    content: {
      'application/json': {
        examples: {
          CLAIM_NOT_FOUND: {
            summary: 'Claim not found',
            value: { code: 'CLAIM_NOT_FOUND', message: 'Claim not found.' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async submitAppealVote(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { walletAddress: string; vote: 'Approve' | 'Reject'; signedXdr: string },
  ): Promise<{ transactionHash: string; status: string; approve_votes: number; reject_votes: number }> {
    return this.claimsService.submitAppealVote(id, body.walletAddress, body.vote, body.signedXdr);
  }
}
