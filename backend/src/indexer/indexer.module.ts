import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { IndexerService } from './indexer.service';
import { IndexerWorker } from './indexer.worker';
import { ReindexWorkerService } from './reindex.worker';
import { BackfillWorkerService } from './backfill.worker';
import { ReconciliationService } from './reconciliation.service';
import { LedgerBatchProcessor } from './ledger-batch.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { RpcModule } from '../rpc/rpc.module';
import { EventsModule } from '../events/events.module';
import { OutboundWebhookService } from '../webhooks/outbound-webhook.service';
import { PolicyIsActiveReconciliationService } from '../jobs/policy-isactive-reconciliation.service';
import { INDEXER_QUEUE } from './indexer.constants';

@Module({
  imports: [
    PrismaModule,
    RpcModule,
    ConfigModule,
    ScheduleModule.forRoot(),
    EventsModule,
    BullModule.registerQueue({ name: INDEXER_QUEUE }),
  ],
  providers: [
    IndexerService,
    IndexerWorker,
    ReindexWorkerService,
    BackfillWorkerService,
    ReconciliationService,
    PolicyIsActiveReconciliationService,
    OutboundWebhookService,
    LedgerBatchProcessor,
  ],
  exports: [IndexerService, ReconciliationService, PolicyIsActiveReconciliationService, LedgerBatchProcessor],
})
export class IndexerModule {}
