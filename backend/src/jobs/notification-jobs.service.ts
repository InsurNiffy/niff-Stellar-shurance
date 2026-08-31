import {
  NotificationDispatcher,
} from "../notifications/notification-dispatcher";
import { NotificationsService } from "../notifications/notifications.service";
import { enqueueNotification } from "../notifications/notification-jobs.queue";
import { NotificationType } from "../notifications/notification-preference.types";

export interface RenewalReminderJobPayload {
  userId: string;
  policyId: string;
}

export interface ClaimNotificationJobPayload {
  userId: string;
  claimId: string;
  status: string;
}

export interface JobResult {
  delivered: boolean;
  reason?: "preference_disabled";
  jobId?: string;
}

/**
 * Service for enqueueing notifications into priority-based job queues.
 *
 * Critical notifications (claim updates) are enqueued with higher priority to
 * skip ahead of digest notifications (renewal reminders) in the processing queue.
 */
export class NotificationJobsService {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  async sendRenewalReminder(
    payload: RenewalReminderJobPayload,
  ): Promise<JobResult> {
    return this.enqueueIfAllowed({
      userId: payload.userId,
      notificationType: "renewal_reminder",
      message: `Policy ${payload.policyId} is due for renewal.`,
      metadata: { policyId: payload.policyId },
    });
  }

  async sendClaimUpdate(payload: ClaimNotificationJobPayload): Promise<JobResult> {
    return this.enqueueIfAllowed({
      userId: payload.userId,
      notificationType: "claim_update",
      message: `Claim ${payload.claimId} status changed to ${payload.status}.`,
      metadata: { claimId: payload.claimId, status: payload.status },
    });
  }

  private async enqueueIfAllowed(
    notification: {
      userId: string;
      notificationType: NotificationType;
      message: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<JobResult> {
    const shouldSend = await this.notificationsService.shouldSendNotification(
      notification.userId,
      notification.notificationType,
    );

    if (!shouldSend) {
      return { delivered: false, reason: "preference_disabled" };
    }

    // Enqueue into priority-based queue
    const jobId = await enqueueNotification({
      userId: notification.userId,
      notificationType: notification.notificationType,
      message: notification.message,
      metadata: notification.metadata,
    });

    return { delivered: true, jobId };
  }
}
