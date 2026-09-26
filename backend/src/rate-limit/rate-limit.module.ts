import { Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';
import { RateLimitGuard } from './rate-limit.guard';
import { ClaimRateLimitGuard } from './claim-rate-limit.guard';
import { AppealRateLimitGuard } from './appeal-rate-limit.guard';
import { CacheModule } from '../cache/cache.module';
import { RpcModule } from '../rpc/rpc.module';

@Module({
  imports: [CacheModule, RpcModule],
  providers: [RateLimitService, RateLimitGuard, ClaimRateLimitGuard, AppealRateLimitGuard],
  exports: [RateLimitService, RateLimitGuard, ClaimRateLimitGuard, AppealRateLimitGuard],
})
export class RateLimitModule {}
