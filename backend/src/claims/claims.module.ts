import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { ClaimAggregationService } from './claim-aggregation.service';
import { Claim } from './entities/claim.entity';
import { Vote } from './entities/vote.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Claim, Vote]),
    CacheModule.register({ ttl: 30_000 }),
  ],
  controllers: [ClaimsController],
  providers: [ClaimsService, ClaimAggregationService],
  exports: [ClaimsService, ClaimAggregationService],
})
export class ClaimsModule {}
