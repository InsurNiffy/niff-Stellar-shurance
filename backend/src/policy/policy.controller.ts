import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PolicyService } from './policy.service';
import { BuildTransactionDto } from './dto/build-transaction.dto';

@ApiTags('Policy')
@Controller('policy')
export class PolicyController {
  constructor(private readonly policyService: PolicyService) {}

  /**
   * POST /api/policy/build-transaction
   *
   * Returns unsigned XDR for Freighter / wallet-kit to sign.
   * Rate-limited (10 req/min) to protect Soroban RPC quotas.
   *
   * Errors: ACCOUNT_NOT_FOUND, WRONG_NETWORK, CONTRACT_NOT_DEPLOYED,
   *         SIMULATION_FAILED, INSUFFICIENT_BALANCE
   */
  @Post('build-transaction')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Build unsigned initiate_policy transaction' })
  @ApiResponse({ status: 200, description: 'Unsigned transaction XDR + fee estimates' })
  @ApiResponse({ status: 400, description: 'Validation / account / simulation error' })
  @ApiResponse({ status: 429, description: 'Rate limited — protects RPC quotas' })
  @ApiResponse({ status: 503, description: 'Contract not deployed or RPC unavailable' })
  async buildTransaction(@Body() dto: BuildTransactionDto) {
    return this.policyService.buildTransaction(dto);
  }
}
