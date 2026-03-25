import { Injectable, Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
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

  constructor(private readonly notifications: NotificationsService) {
    notificationBus.on('claim:finalized', (event: ClaimFinalizedEvent) => {
      this.notifications.sendClaimNotifications(event).catch((err: unknown) => {
        this.logger.error(
          `Unhandled error for claim ${event.claimId}: ${String(err)}`,
        );
      });
    });
  }

  emit(event: ClaimFinalizedEvent): void {
    notificationBus.emit('claim:finalized', event);
  }
}
