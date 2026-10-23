import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { AllowedAssetsCacheService } from './allowed-assets-cache.service';

@ApiTags('assets')
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AllowedAssetsCacheService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List allowed assets with metadata',
    description:
      'Returns allowlisted SEP-41 asset contracts with symbol, decimals and the ledger they were added at. ' +
      'Cached in Redis (60s TTL) and invalidated on allowlist update events. No authentication required.',
  })
  async listAssets() {
    const assets = await this.cache.getOrCompute(() =>
      this.prisma.allowedAsset.findMany({
        where: { isAllowed: true },
        orderBy: { contractId: 'asc' },
        select: { contractId: true, symbol: true, decimals: true, addedAtLedger: true, updatedAt: true },
      }),
    );
    return { assets };
  }

  @Get('allowed')
  @ApiOperation({
    summary: 'Get allowed assets',
    description:
      'Returns the list of allowlisted SEP-41 asset contracts (symbol, contractId, decimals). ' +
      'Results are cached in Redis and invalidated when the on-chain asset allowlist is updated. ' +
      'No authentication required.',
  })
  async getAllowedAssets() {
    const assets = await this.cache.getOrCompute(async () => {
      return this.prisma.allowedAsset.findMany({
        where: { isAllowed: true },
        select: {
          contractId: true,
          symbol: true,
          decimals: true,
        },
      });
    });

    return {
      assets: assets.map((a) => ({
        contractId: a.contractId,
        symbol: a.symbol,
        decimals: a.decimals,
      })),
    };
  }
}
