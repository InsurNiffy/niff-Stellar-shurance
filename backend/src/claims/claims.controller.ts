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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ClaimsService } from './claims.service';
import { ClaimsListResponseDto, ClaimDetailResponseDto } from './dto/claim.dto';
import { BuildClaimTransactionDto } from './dto/build-claim-transaction.dto';
import { SubmitTransactionDto } from './dto/submit-transaction.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletAddress } from '../auth/decorators/wallet-address.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { MAX_LIMIT, DEFAULT_LIMIT } from '../helpers/pagination';
import { OptionalJwtAuthGuard } from '../tx/guards/optional-jwt.guard';

/** Maximum claim IDs accepted per status-poll or SSE subscription. */
const MAX_WATCH_IDS = 50;

@ApiTags('claims')
@Controller('claims')
export class ClaimsController {
  constructor(private readonly claimsService: ClaimsService) {}

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
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit signed claim transaction' })
  @ApiResponse({ status: 200, description: 'Transaction submitted' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async submitTransaction(@Body() dto: SubmitTransactionDto) {
    return this.claimsService.submitTransaction(dto.transactionXdr);
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
}
