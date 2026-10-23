import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SorobanService } from '../rpc/soroban.service';
import { GetPoliciesBatchDto } from './dto/get-policies-batch.dto';
import { GetClaimsBatchDto } from './dto/get-claims-batch.dto';
import { getNetworkConfig } from '../config/network.config';

@ApiTags('chain')
@Controller('chain')
export class ChainController {
  constructor(private readonly soroban: SorobanService) {}

  /**
   * GET /chain/info
   *
   * Returns the active network and contract address. The passphrase itself is
   * validated against STELLAR_NETWORK at startup (see loadNetworkConfig).
   */
  @Get('info')
  @ApiOperation({ summary: 'Get active network name and contract address' })
  getInfo(): { network: string; contractAddress: string } {
    const config = getNetworkConfig();
    return { network: config.network, contractAddress: config.contractIds.niffyinsure };
  }

  @Post('policies/batch')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Batch-read policies via Soroban simulation',
    description:
      'Invokes get_policies_batch in a single simulated transaction. Missing policies appear as null in the same positions as the request keys. Over 20 keys returns 400.',
  })
  async getPoliciesBatch(
    @Body() dto: GetPoliciesBatchDto,
  ): Promise<{ results: (Record<string, unknown> | null)[] }> {
    const results = await this.soroban.simulateGetPoliciesBatch({
      keys: dto.keys.map((k) => ({ holder: k.holder, policy_id: k.policy_id })),
      sourceAccount: dto.source_account,
    });
    return { results };
  }

  @Post('claims/batch')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Batch-read claims via Soroban simulation',
    description:
      'Invokes get_claims_batch in a single simulated transaction. Missing claims appear as null in the same positions as the request IDs. Over 20 IDs returns 400.',
  })
  async getClaimsBatch(
    @Body() dto: GetClaimsBatchDto,
  ): Promise<{ results: (Record<string, unknown> | null)[] }> {
    const results = await this.soroban.simulateGetClaimsBatch({
      ids: dto.ids,
      sourceAccount: dto.source_account,
    });
    return { results };
  }

  /**
   * GET /chain/treasury-balance
   *
   * Returns the contract's own premium-token balance in minor units (stroops).
   * Callable without authentication — read-only simulation, no state mutation.
   *
   * Decimal interpretation: 1 XLM = 10_000_000 stroops (7 decimal places).
   * For multi-asset deployments, this reflects the DEFAULT_TOKEN_CONTRACT_ID balance.
   * Per-asset variants should be added here when multi-asset is enabled.
   */
  @Get('treasury-balance')
  @ApiOperation({
    summary: 'Get contract treasury balance (minor units)',
    description:
      'Simulates get_treasury_balance() on-chain. Returns raw stroops; divide by 10^7 for XLM. ' +
      'No authentication required. Does not mutate state.',
  })
  @ApiQuery({
    name: 'source_account',
    required: true,
    description: 'Stellar public key used as the simulation source account.',
  })
  async getTreasuryBalance(
    @Query('source_account') sourceAccount: string,
  ): Promise<{ balanceStroops: string; minResourceFee: string }> {
    return this.soroban.simulateGetTreasuryBalance({ sourceAccount });
  }
}
