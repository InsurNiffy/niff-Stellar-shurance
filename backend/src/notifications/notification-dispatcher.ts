import { NotificationType } from "./notification-preference.types";

export interface NotificationDispatch {
  userId: string;
  notificationType: NotificationType;
  message: string;
}

export interface NotificationDispatcher {
  send(dispatch: NotificationDispatch): Promise<void>;
}

export class InMemoryNotificationDispatcher implements NotificationDispatcher {
  public readonly sent: NotificationDispatch[] = [];

  async send(dispatch: NotificationDispatch): Promise<void> {
    this.sent.push(dispatch);
  }
}
