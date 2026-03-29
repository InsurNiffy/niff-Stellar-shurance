import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IndexerService } from './indexer.service';
import { IndexerWorker } from './indexer.worker';
import { ReindexWorkerService } from './reindex.worker';
import { PrismaModule } from '../prisma/prisma.module';
import { RpcModule } from '../rpc/rpc.module';
import { QuoteModule } from '../quote/quote.module';

@Module({
  imports: [PrismaModule, RpcModule, ConfigModule],
  providers: [IndexerService, IndexerWorker, ReindexWorkerService],
  exports: [IndexerService],
})
export class IndexerModule {}
