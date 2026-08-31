import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../metrics/metrics.service';
import type { ClaimFinalizedEvent } from './notification.types';

interface BatchedEvent {
  event: ClaimFinalizedEvent;
  timestamp: number;
}

interface WalletBatch {
  events: BatchedEvent[];
  timer: NodeJS.Timeout | null;
}

const DEFAULT_BATCH_WINDOW_MS = 60_000; // 60 seconds

@Injectable()
export class ClaimNotificationBatchService {
  private readonly logger = new Logger(ClaimNotificationBatchService.name);
  private readonly batchWindowMs: number;
  private readonly batches = new Map<string, WalletBatch>();

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.batchWindowMs = this.config.get<number>(
      'NOTIFICATION_BATCH_WINDOW_MS',
      DEFAULT_BATCH_WINDOW_MS,
    );
  }

  /**
   * Accumulate a claim update event into a batch for the given wallet.
   * Returns a function to call when the batch should be flushed.
   */
  async accumulateEvent(
    event: ClaimFinalizedEvent,
    onFlush: (events: ClaimFinalizedEvent[]) => Promise<void>,
  ): Promise<void> {
    const walletKey = event.claimantPublicKey;

    // Get or create batch for this wallet
    let batch = this.batches.get(walletKey);
    if (!batch) {
      batch = { events: [], timer: null };
      this.batches.set(walletKey, batch);
    }

    // Clear existing timer if it exists
    if (batch.timer) {
      clearTimeout(batch.timer);
    }

    // Add event to batch
    batch.events.push({
      event,
      timestamp: Date.now(),
    });

    this.metrics?.recordClaimNotificationBatch('accumulated', {
      walletAddress: walletKey,
      eventCount: batch.events.length,
    });

    // Set timer to flush batch after window
    batch.timer = setTimeout(async () => {
      await this.flushBatch(walletKey, onFlush);
    }, this.batchWindowMs);
  }

  private async flushBatch(
    walletKey: string,
    onFlush: (events: ClaimFinalizedEvent[]) => Promise<void>,
  ): Promise<void> {
    const batch = this.batches.get(walletKey);
    if (!batch || batch.events.length === 0) {
      return;
    }

    const events = batch.events.map((b) => b.event);
    this.batches.delete(walletKey);

    this.metrics?.recordClaimNotificationBatch('flushed', {
      walletAddress: walletKey,
      eventCount: events.length,
    });

    try {
      await onFlush(events);
      this.logger.debug(`Flushed ${events.length} claim updates for wallet ${walletKey}`);
    } catch (err) {
      this.logger.error(
        `Failed to flush batch for wallet ${walletKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
