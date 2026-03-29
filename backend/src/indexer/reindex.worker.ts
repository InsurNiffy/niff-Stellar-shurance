import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { getBullMQConnection } from '../redis/client';
import { IndexerService } from './indexer.service';

/**
 * Consumes BullMQ `reindex` jobs after admin resets the ledger cursor.
 * Catches up projections in-process (same binary as the periodic indexer worker).
 */
@Injectable()
export class ReindexWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReindexWorkerService.name);
  private worker?: Worker;

  constructor(private readonly indexer: IndexerService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.DISABLE_REINDEX_WORKER === '1') {
      this.logger.log('Reindex BullMQ worker disabled (test or DISABLE_REINDEX_WORKER)');
      return;
    }
    try {
      this.worker = new Worker(
        'reindex',
        async (job) => {
          const network = (job.data as { network?: string }).network;
          await this.indexer.processUntilCaughtUp(network);
        },
        { connection: getBullMQConnection() },
      );
      this.worker.on('failed', (job, err) => {
        this.logger.error(`Reindex job ${job?.id} failed: ${err?.message}`, err?.stack);
      });
    } catch (err) {
      this.logger.warn(`Reindex worker not started: ${String(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
