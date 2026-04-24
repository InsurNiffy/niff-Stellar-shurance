import {
  NotificationDispatch,
  NotificationDispatcher,
} from "../notifications/notification-dispatcher";
import { NotificationsService } from "../notifications/notifications.service";

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
}

export class NotificationJobsService {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  async sendRenewalReminder(
    payload: RenewalReminderJobPayload,
  ): Promise<JobResult> {
    return this.dispatchIfAllowed({
      userId: payload.userId,
      notificationType: "renewal_reminder",
      message: `Policy ${payload.policyId} is due for renewal.`,
    });
  }

  async sendClaimUpdate(payload: ClaimNotificationJobPayload): Promise<JobResult> {
    return this.dispatchIfAllowed({
      userId: payload.userId,
      notificationType: "claim_update",
      message: `Claim ${payload.claimId} status changed to ${payload.status}.`,
    });
  }

  private async dispatchIfAllowed(
    dispatch: NotificationDispatch,
  ): Promise<JobResult> {
    const shouldSend = await this.notificationsService.shouldSendNotification(
      dispatch.userId,
      dispatch.notificationType,
    );

    if (!shouldSend) {
      return { delivered: false, reason: "preference_disabled" };
    }

    await this.dispatcher.send(dispatch);
    return { delivered: true };
  }
}
