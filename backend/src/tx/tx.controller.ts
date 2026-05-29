/**
 * TxController — POST /tx/build, POST /tx/submit, GET /tx/status/:jobId
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
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { TxService } from './tx.service';
import { BuildTxDto } from './dto/build-tx.dto';
import { SubmitTxDto } from './dto/submit-tx.dto';
import { OptionalJwtAuthGuard } from './guards/optional-jwt.guard';

@ApiTags('Transactions')
@Controller('tx')
export class TxController {
  constructor(private readonly txService: TxService) {}

  /**
   * POST /api/tx/build
   *
   * Assembles an unsigned invokeHostFunction transaction with simulation-derived
   * footprints and fee estimates. Pass simulate=true to inspect resources only.
   */
  @Post('build')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Assemble unsigned Soroban transaction' })
  @ApiResponse({ status: 200, description: 'Unsigned XDR + fee estimates' })
  @ApiResponse({ status: 400, description: 'Validation / account / simulation error' })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  @ApiResponse({ status: 503, description: 'Contract not deployed or RPC unavailable' })
  async build(@Body() dto: BuildTxDto) {
    return this.txService.build(dto);
  }

  /**
   * POST /api/tx/submit
   *
   * Validates the signed XDR envelope structure, enqueues it for async
   * Soroban RPC submission, and returns immediately with { jobId, status: 'queued' }.
   * Poll GET /api/tx/status/:jobId for the final result.
   */
  @Post('submit')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Enqueue signed XDR for async Soroban submission',
    description:
      'Validates the signed envelope then enqueues it. Returns immediately with jobId. ' +
      'Poll GET /tx/status/:jobId for the final result.',
  })
  @ApiResponse({ status: 202, description: '{ jobId, status: "queued" }' })
  @ApiResponse({ status: 400, description: 'Malformed XDR or missing signatures' })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  async submit(@Body() dto: SubmitTxDto) {
    return this.txService.enqueueSubmit(dto);
  }

  /**
   * GET /api/tx/status/:jobId
   *
   * Returns the latest lifecycle state for a queued transaction job.
   * States: queued → processing → success | failed
   */
  @Get('status/:jobId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get async transaction job status' })
  @ApiParam({ name: 'jobId', description: 'Job ID returned by POST /tx/submit' })
  @ApiResponse({ status: 200, description: 'TxState object with status and result details' })
  @ApiResponse({ status: 404, description: 'Job not found or expired' })
  async getStatus(@Param('jobId') jobId: string) {
    return this.txService.getStatus(jobId);
  }
}
