/**
 * Notification job worker — processes notification jobs from the priority queue.
 *
 * Priority handling:
 * - Critical notifications (priority 10): claim updates, escalations
 * - Digest notifications (priority 5): renewal reminders, summaries
 *
 * BullMQ processes jobs in order of priority + FIFO within the same priority.
 */

import { Worker, Job } from 'bullmq';
import { getBullMQConnection } from '../redis/client';
import { getNotificationQueue, NotificationJobData } from './notification-jobs.queue';
import { NOTIFICATION_QUEUE_NAME } from './notification-queue.constants';

export type NotificationProcessor = (job: Job<NotificationJobData>) => Promise<void>;

/**
 * Start the notification worker.
 * Returns the Worker instance for graceful shutdown.
 */
export function startNotificationWorker(
  processor: NotificationProcessor,
  concurrency: number = 5,
): Worker<NotificationJobData> {
  const worker = new Worker<NotificationJobData>(
    NOTIFICATION_QUEUE_NAME,
    processor,
    {
      connection: getBullMQConnection(),
      concurrency,
      stalledInterval: 30_000,
      maxStalledCount: 2,
    },
  );

  worker.on('completed', (job: Job<NotificationJobData>) => {
    console.info(
      `[notification-worker] job ${job.id} completed (${job.data.notificationType})`,
    );
  });

  worker.on('failed', (job: Job<NotificationJobData> | undefined, err: Error) => {
    console.error(
      `[notification-worker] job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
    );
  });

  worker.on('stalled', (jobId: string) => {
    console.warn(`[notification-worker] job ${jobId} stalled — will be requeued`);
  });

  worker.on('error', (err: Error) => {
    console.error(`[notification-worker] worker error: ${err.message}`);
  });

  return worker;
}

export async function closeNotificationWorker(worker: Worker): Promise<void> {
  await worker.close();
  await getNotificationQueue().close();
}
