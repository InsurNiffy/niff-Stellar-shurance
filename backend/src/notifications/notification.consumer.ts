/**
 * Notification consumer.
 *
 * Listens for `claim:finalized` events emitted on the shared EventEmitter and
 * dispatches sendClaimNotifications for each event.
 *
 * In production, replace the EventEmitter with a proper message queue consumer
 * (e.g. BullMQ, AWS SQS, RabbitMQ) reacting to indexer-emitted events or
 * DB triggers from the claim status state machine.
 *
 * The consumer is idempotent: duplicate events are deduped inside
 * sendClaimNotifications via the sentSet.
 */

import EventEmitter from 'events';
import type { ClaimFinalizedEvent } from './notification.types';
import { sendClaimNotifications } from './notification.service';

export const notificationBus = new EventEmitter();

notificationBus.on(
  'claim:finalized',
  (event: ClaimFinalizedEvent) => {
    sendClaimNotifications(event).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[notification-consumer] Unhandled error processing claim ${event.claimId}:`,
        msg,
      );
    });
  },
);

/**
 * Emit a claim finalization event into the consumer pipeline.
 * Called by the indexer integration or admin trigger endpoint.
 */
export function emitClaimFinalized(event: ClaimFinalizedEvent): void {
  notificationBus.emit('claim:finalized', event);
}
