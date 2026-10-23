/**
 * TxController — POST /tx/build and POST /tx/submit
 *
 * Rate limits:
 *  - /tx/build  : 10 req/min per IP (protects Soroban RPC simulation quota)
 *  - /tx/submit : 20 req/min per IP (network submissions are cheaper to rate-limit loosely)
 *
 * Authentication:
 *  Both endpoints accept an optional JWT Bearer token. When present, the
 *  authenticated subject (wallet address) is available for per-user rate
 *  limiting and audit logging. Unauthenticated requests are still served
 *  (wallets may not be logged in yet at build time).
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { TxService } from './tx.service';
import { BuildTxDto } from './dto/build-tx.dto';
import { SubmitTxDto } from './dto/submit-tx.dto';
import { EnqueueTxDto } from './dto/enqueue-tx.dto';
import { TxSubmitQueue } from './tx-submit.queue';
import { OptionalJwtAuthGuard } from './guards/optional-jwt.guard';
import { WalletRateLimitGuard } from '../rate-limit/wallet-rate-limit.guard';

@ApiTags('Transactions')
@Controller('tx')
export class TxController {
  constructor(
    private readonly txService: TxService,
    private readonly txSubmitQueue: TxSubmitQueue,
  ) {}

  /**
   * POST /api/tx/build
   *
   * Assembles an unsigned invokeHostFunction transaction with simulation-derived
   * footprints and fee estimates. Pass simulate=true to inspect resources only.
   *
   * The returned unsignedXdr must be signed by the wallet and submitted via
   * POST /api/tx/submit. The backend never holds private keys.
   *
   * Errors: ACCOUNT_NOT_FOUND, WRONG_NETWORK, CONTRACT_NOT_DEPLOYED,
   *         SIMULATION_FAILED, INSUFFICIENT_BALANCE, UNSUPPORTED_FUNCTION
   */
  @Post('build')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Assemble unsigned Soroban transaction',
    description:
      'Builds an invokeHostFunction transaction with simulation-derived footprints. ' +
      'Pass simulate=true to get resource estimates without building the full envelope.',
  })
  @ApiResponse({ status: 200, description: 'Unsigned XDR + fee estimates (or simulation resources)' })
  @ApiResponse({ status: 400, description: 'Validation / account / simulation error — structured code + message' })
  @ApiResponse({ status: 429, description: 'Rate limited — 10 req/min per IP' })
  @ApiResponse({ status: 503, description: 'Contract not deployed or RPC unavailable' })
  async build(@Body() dto: BuildTxDto) {
    return this.txService.build(dto);
  }

  /**
   * POST /api/tx/submit
   *
   * Validates the signed XDR envelope structure, then submits to the Soroban RPC.
   * Supports idempotency_key (UUID v4) — re-submitting the same key within 10 min
   * returns the cached result without hitting the network again.
   *
   * Errors: INVALID_XDR, FEE_BUMP_NOT_SUPPORTED, MISSING_SIGNATURES,
   *         EMPTY_OPERATIONS, INVALID_OPERATION_TYPE, TX_BAD_SEQ, TX_BAD_AUTH,
   *         TX_INSUFFICIENT_FEE, TX_INSUFFICIENT_BALANCE, TX_NO_ACCOUNT,
   *         TX_FAILED, TX_TOO_EARLY, TX_TOO_LATE, TX_INTERNAL_ERROR
   */
  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(OptionalJwtAuthGuard, WalletRateLimitGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Submit signed XDR to the Stellar network',
    description:
      'Validates the signed envelope before submission. ' +
      'Supports idempotency_key to safely retry without double-submitting.',
  })
  @ApiResponse({ status: 200, description: 'Submission result with hash and status' })
  @ApiResponse({ status: 400, description: 'Malformed XDR or missing signatures — structured code + message' })
  @ApiResponse({ status: 429, description: 'Rate limited — 20 req/min per IP' })
  @ApiResponse({ status: 503, description: 'RPC unavailable' })
  async submit(@Body() dto: SubmitTxDto) {
    return this.txService.submit(dto);
  }

  /**
   * POST /api/tx/enqueue
   * Enqueues the signed XDR for async submission. Returns immediately with jobId.
   */
  @Post('enqueue')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enqueue signed XDR for async submission' })
  @ApiResponse({ status: 202, description: '{ jobId, status: "queued" }' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  async enqueue(@Body() dto: EnqueueTxDto) {
    const jobId = await this.txSubmitQueue.enqueue({
      signed_xdr: dto.signed_xdr,
      idempotency_key: dto.idempotency_key,
    });
    return { jobId, status: 'queued' };
  }

  /**
   * GET /api/tx/status/:jobId
   * Returns current status and result of an enqueued TX job.
   */
  @Get('status/:jobId')
  @ApiOperation({ summary: 'Get async TX job status' })
  @ApiResponse({ status: 200, description: 'Job status and result' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getStatus(@Param('jobId') jobId: string) {
    const status = await this.txSubmitQueue.getStatus(jobId);
    if (status.status === 'unknown') {
      throw new NotFoundException(`Job ${jobId} not found`);
    }
    return status;
  }
}
