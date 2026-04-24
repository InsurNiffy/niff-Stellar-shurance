import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { IndexerService } from './indexer.service';
import { IndexerWorker } from './indexer.worker';
import { ReindexWorkerService } from './reindex.worker';
import { ReconciliationService } from './reconciliation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RpcModule } from '../rpc/rpc.module';
import { QuoteModule } from '../quote/quote.module';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [PrismaModule, RpcModule, ConfigModule, ScheduleModule.forFeature()],
  providers: [IndexerService, IndexerWorker, ReindexWorkerService, ReconciliationService],
  exports: [IndexerService, ReconciliationService],
})
export class IndexerModule {}
