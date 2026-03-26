import { Module } from '@nestjs/common';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { SanitizationService } from './sanitization.service';
import { RpcModule } from '../rpc/rpc.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';

@Module({
  imports: [RpcModule, RateLimitModule],
  controllers: [ClaimsController],
  providers: [ClaimsService, SanitizationService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
