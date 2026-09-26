import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CacheModule } from '../cache/cache.module';
import { MetricsModule } from '../metrics/metrics.module';
import { AssetsController } from './assets.controller';
import { AllowedAssetsCacheService } from './allowed-assets-cache.service';

@Module({
  imports: [PrismaModule, CacheModule, MetricsModule],
  controllers: [AssetsController],
  providers: [AllowedAssetsCacheService],
  exports: [AllowedAssetsCacheService],
})
export class AssetsModule {}
