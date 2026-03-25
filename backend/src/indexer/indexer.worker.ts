import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { IndexerService } from './indexer.service';

@Injectable()
export class IndexerWorker implements OnModuleInit {
  private readonly logger = new Logger(IndexerWorker.name);
  private isProcessing = false;

  constructor(private readonly indexerService: IndexerService) {}

  onModuleInit() {
    this.logger.log('Starting Indexer Worker loop...');
    // Initial delay to let the app bootstrap
    setTimeout(() => this.runLoop(), 5000);
  }

  private runLoop() {
    // Using a self-scheduling timeout instead of setInterval to avoid overlapping runs
    // if processing takes longer than the interval.
    this.run()
      .catch(err => this.logger.error('Fatal Indexer Loop Error', err))
      .finally(() => {
        setTimeout(() => this.runLoop(), 5000);
      });
  }

  async run() {
    if (this.isProcessing) return;

    this.isProcessing = true;
    try {
      let result;
      // Keep processing batches until we've caught up (no more events processed in the last batch)
      do {
        result = await this.indexerService.processNextBatch();
        if (result.processed > 0) {
            this.logger.debug(`Processed ${result.processed} events, lag: ${result.lag} ledgers`);
        }
      } while (result.processed > 0);
    } catch (err: any) {
      this.logger.error(`Indexer Worker Error: ${err.message}`, err.stack);
      // We don't rethrow here because the loop handles scheduling the next attempt
    } finally {
      this.isProcessing = false;
    }
  }
}
