import { Module } from '@nestjs/common';
import { QuoteController } from './quote.controller';
import { QuoteService } from './quote.service';
import { QuoteSimulationCacheService } from './quote-simulation-cache.service';
import { RpcModule } from '../rpc/rpc.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RpcModule, RedisModule],
  controllers: [QuoteController],
  providers: [QuoteService, QuoteSimulationCacheService],
  exports: [QuoteSimulationCacheService],
})
export class QuoteModule {}
