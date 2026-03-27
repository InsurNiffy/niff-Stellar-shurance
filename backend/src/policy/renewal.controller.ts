import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RenewalService } from './renewal.service';
import { BuildRenewalTransactionDto } from './dto/renewal.dto';

@ApiTags('Policy')
@Controller('policy')
export class RenewalController {
  constructor(private readonly renewalService: RenewalService) {}

  /**
   * POST /api/policy/renewal/quote
   *
   * Returns a renewal premium quote and window metadata without building a
   * transaction. Safe to call repeatedly — no side effects.
   *
   * Errors: POLICY_NOT_FOUND, POLICY_INACTIVE, RENEWAL_TOO_EARLY,
   *         RENEWAL_TOO_LATE, OPEN_CLAIM_BLOCKS_RENEWAL
   */
  @Post('renewal/quote')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get renewal premium quote and window metadata' })
  @ApiResponse({ status: 200, description: 'Renewal quote with window ledgers and premium' })
  @ApiResponse({ status: 400, description: 'Window violation or open claim' })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  async quoteRenewal(@Body() dto: BuildRenewalTransactionDto) {
    return this.renewalService.quoteRenewal(dto);
  }

  /**
   * POST /api/policy/renewal/build-transaction
   *
   * Returns unsigned XDR for Freighter / wallet-kit to sign.
   * Emits a PolicyRenewed event exactly once on success.
   * Rate-limited (10 req/min) to protect Soroban RPC quotas.
   *
   * Errors: POLICY_NOT_FOUND, POLICY_INACTIVE, RENEWAL_TOO_EARLY,
   *         RENEWAL_TOO_LATE, OPEN_CLAIM_BLOCKS_RENEWAL, PREMIUM_OVERFLOW,
   *         ACCOUNT_NOT_FOUND, CONTRACT_NOT_DEPLOYED, SIMULATION_FAILED
   */
  @Post('renewal/build-transaction')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Build unsigned renew_policy transaction' })
  @ApiResponse({ status: 200, description: 'Unsigned XDR + fee estimates + renewal metadata' })
  @ApiResponse({ status: 400, description: 'Window violation, open claim, or simulation error' })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  @ApiResponse({ status: 429, description: 'Rate limited — protects RPC quotas' })
  @ApiResponse({ status: 503, description: 'Contract not deployed or RPC unavailable' })
  async buildRenewalTransaction(@Body() dto: BuildRenewalTransactionDto) {
    return this.renewalService.buildRenewalTransaction(dto);
  }
}
