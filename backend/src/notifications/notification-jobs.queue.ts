/**
 * Notification job queue producer with priority lanes.
 *
 * Enqueues notifications into the shared BullMQ queue with priority-based
 * routing: critical notifications (claim updates) skip ahead of digest jobs
 * (renewal reminders), ensuring time-sensitive alerts reach users promptly.
 */

import { Queue } from 'bullmq';
import { getBullMQConnection } from '../redis/client';
import {
  NOTIFICATION_QUEUE_NAME,
  NOTIFICATION_JOB_OPTIONS,
  getPriorityForNotificationType,
} from './notification-queue.constants';
import { NotificationType } from './notification-preference.types';

export interface NotificationJobData {
  userId: string;
  notificationType: NotificationType;
  message: string;
  metadata?: Record<string, unknown>;
}

let _queue: Queue<NotificationJobData> | null = null;

export function getNotificationQueue(): Queue<NotificationJobData> {
  if (!_queue) {
    _queue = new Queue<NotificationJobData>(NOTIFICATION_QUEUE_NAME, {
      connection: getBullMQConnection(),
      defaultJobOptions: NOTIFICATION_JOB_OPTIONS,
    });
  }
  return _queue;
}

/**
 * Enqueue a notification for delivery, routed to the appropriate priority lane.
 * Returns the job ID if enqueued.
 */
export async function enqueueNotification(
  data: NotificationJobData,
): Promise<string> {
  const queue = getNotificationQueue();
  const priority = getPriorityForNotificationType(data.notificationType);

  const job = await queue.add(`notification:${data.notificationType}`, data, {
    ...NOTIFICATION_JOB_OPTIONS,
    priority,
  });

  return job.id ?? 'unknown';
}

export async function closeNotificationQueue(): Promise<void> {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
}
