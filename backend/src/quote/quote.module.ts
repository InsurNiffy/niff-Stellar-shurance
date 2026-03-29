import { Module } from '@nestjs/common';
import { QuoteController } from './quote.controller';
import { QuoteService } from './quote.service';
import { QuoteSimulationCacheService } from './quote-simulation-cache.service';
import { RpcModule } from '../rpc/rpc.module';

@Module({
  imports: [RpcModule],
  controllers: [QuoteController],
  providers: [QuoteService, QuoteSimulationCacheService],
  exports: [QuoteSimulationCacheService],
})
export class QuoteModule {}
