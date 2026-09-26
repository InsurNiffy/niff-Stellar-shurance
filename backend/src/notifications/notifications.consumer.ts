import { Injectable, Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { ClaimNotificationBatchService } from './claim-notification-batch.service';
import type { ClaimFinalizedEvent } from './notification.types';
import { EventEmitter } from 'events';

/**
 * Shared event bus. In production, replace with a BullMQ/SQS consumer
 * reacting to indexer-emitted events or DB triggers.
 */
export const notificationBus = new EventEmitter();

@Injectable()
export class NotificationsConsumer {
  private readonly logger = new Logger(NotificationsConsumer.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly batch: ClaimNotificationBatchService,
  ) {
    notificationBus.on('claim:finalized', (event: ClaimFinalizedEvent) => {
      this.batch.accumulateEvent(event, async (events) => {
        for (const evt of events) {
          await this.notifications.sendClaimNotifications(evt).catch((err: unknown) => {
            this.logger.error(
              `Unhandled error for claim ${evt.claimId}: ${String(err)}`,
            );
          });
        }
      }).catch((err: unknown) => {
        this.logger.error(
          `Failed to accumulate event for claim ${event.claimId}: ${String(err)}`,
        );
      });
    });
  }

  emit(event: ClaimFinalizedEvent): void {
    notificationBus.emit('claim:finalized', event);
  }
}
