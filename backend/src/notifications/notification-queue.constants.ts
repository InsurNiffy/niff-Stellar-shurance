/**
 * Notification queue configuration: priority lanes for critical vs digest notifications.
 *
 * PRIORITY CLASSIFICATION
 * ──────────────────────────────────────────────────────────────────────────────
 * - CRITICAL (priority 10): Time-sensitive notifications that require immediate
 *   processing (claim status updates, escalations, etc).
 *   These are enqueued with higher priority to skip ahead of batch jobs.
 *
 * - DIGEST/BATCH (priority 5): Lower-urgency notifications that can wait
 *   (renewal reminders, summaries, etc).
 *   These are processed after critical jobs.
 *
 * BullMQ: Lower numbers = higher priority. A job with priority 10 runs before
 * a job with priority 5, all else being equal (same queue, waiting state).
 */

import { NotificationType } from './notification-preference.types';
import { getQueueRetryConfig } from '../queues/queue-config';

export const NOTIFICATION_QUEUE_NAME = 'notifications';

export type NotificationPriority = 'critical' | 'digest';

/**
 * Map notification types to their priority lanes.
 * Configure here to classify new notification types without code changes.
 */
export const NOTIFICATION_TYPE_PRIORITY: Record<NotificationType, NotificationPriority> = {
  claim_update: 'critical',
  renewal_reminder: 'digest',
};

/**
 * BullMQ priority values for each lane.
 * Lower number = processed first.
 */
export const PRIORITY_VALUES: Record<NotificationPriority, number> = {
  critical: 10,
  digest: 5,
};

/**
 * Get the priority value for a notification type.
 */
export function getPriorityForNotificationType(
  notificationType: NotificationType,
): number {
  const lane = NOTIFICATION_TYPE_PRIORITY[notificationType];
  return PRIORITY_VALUES[lane];
}

/**
 * BullMQ job options for notification delivery jobs.
 */
export const NOTIFICATION_JOB_OPTIONS = (() => {
  const cfg = getQueueRetryConfig('notifications');
  return {
    attempts: cfg.maxAttempts,
    backoff: cfg.backoff,
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
  };
})();
