import { Controller, Get, Post, Body, HttpCode, HttpStatus, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PolicyService } from './policy.service';
import { PolicyReadService } from './policy-read.service';
import { BuildTransactionDto } from './dto/build-transaction.dto';
import { SearchPoliciesDto } from './dto/search-policies.dto';
import { WalletRateLimitGuard } from '../rate-limit/wallet-rate-limit.guard';
import { GeoBlockGuard } from './geo-block.guard';

@ApiTags('Policy')
@Controller('policy')
export class PolicyController {
  constructor(
    private readonly policyService: PolicyService,
    private readonly policyReadService: PolicyReadService,
  ) {}

  /**
   * GET /api/policy/search
   *
   * Flexible policy search with cursor pagination and tenant isolation.
   * Filters: holder (ILIKE), type (exact), region (exact), active (boolean).
   */
  @Get('search')
  @ApiOperation({ summary: 'Search policies by holder, type, region, and active status' })
  @ApiResponse({ status: 200, description: 'Paginated policy search results' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters or cursor' })
  async searchPolicies(@Query() query: SearchPoliciesDto) {
    return this.policyReadService.searchPolicies({
      holder: query.holder,
      type: query.type,
      region: query.region,
      active: query.active,
      after: query.after,
      first: query.first,
    });
  }

  /**
   * GET /api/policy/regions
   *
   * Returns the list of available policy region risk tiers.
   */
  @Get('regions')
  @ApiOperation({ summary: 'List available policy regions' })
  @ApiResponse({ status: 200, description: 'Available region risk tiers' })
  async getRegions() {
    return [
      { id: 'Low', label: 'Low Risk', factor: 8, description: 'Low-risk geographical regions with stable conditions.' },
      { id: 'Medium', label: 'Medium Risk', factor: 10, description: 'Moderate-risk regions with some variability.' },
      { id: 'High', label: 'High Risk', factor: 14, description: 'High-risk regions with elevated claim probability.' },
    ];
  }

  /**
   * POST /api/policy/build-transaction
   *
   * Returns unsigned XDR for Freighter / wallet-kit to sign.
   * Rate-limited (10 req/min) to protect Soroban RPC quotas.
   * Per-wallet sliding window enforced via WalletRateLimitGuard.
   *
   * Errors: ACCOUNT_NOT_FOUND, WRONG_NETWORK, CONTRACT_NOT_DEPLOYED,
   *         SIMULATION_FAILED, INSUFFICIENT_BALANCE
   */
  @Post('build-transaction')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(WalletRateLimitGuard, GeoBlockGuard)
  @ApiOperation({ summary: 'Build unsigned initiate_policy transaction' })
  @ApiResponse({ status: 200, description: 'Unsigned transaction XDR + fee estimates' })
  @ApiResponse({ status: 400, description: 'Validation / account / simulation error' })
  @ApiResponse({ status: 429, description: 'Rate limited — protects RPC quotas' })
  @ApiResponse({ status: 451, description: 'Blocked jurisdiction (BLOCKED_COUNTRIES)' })
  @ApiResponse({ status: 503, description: 'Contract not deployed or RPC unavailable' })
  async buildTransaction(@Body() dto: BuildTransactionDto) {
    return this.policyService.buildTransaction(dto);
  }
}
