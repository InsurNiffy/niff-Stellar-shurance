import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationPreference } from './notification-preference.entity';
import { Notification } from './notification.entity';

export interface NotificationJobData {
  userId: string;
  type: string;
  refId: string;
  channel: 'email' | 'push';
  payload?: Record<string, unknown>;
}

@Processor('notifications')
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    @InjectRepository(NotificationPreference)
    private readonly preferences: Repository<NotificationPreference>,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const { userId, type, refId, channel, payload } = job.data;

    const preference = await this.preferences.findOne({
      where: { userId, type },
    });

    if (!preference || !this.isOptedIn(preference, channel)) {
      this.logger.debug(
        `Skipping ${channel} notification for user ${userId} (type=${type}) — opted out`,
      );
      return;
    }

    const existing = await this.notifications.findOne({
      where: { userId, type, refId, channel },
    });
    if (existing) {
      this.logger.debug(
        `Duplicate ${channel} notification for user ${userId} (type=${type}, refId=${refId}) — skipping`,
      );
      return;
    }

    const record = this.notifications.create({
      userId,
      type,
      refId,
      channel,
      payload: payload ?? {},
      acknowledged: false,
    });
    await this.notifications.save(record);

    if (channel === 'email') {
      await this.deliverEmail(userId, type, payload);
    } else {
      await this.deliverPush(userId, type, payload);
    }
  }

  private isOptedIn(
    preference: NotificationPreference,
    channel: 'email' | 'push',
  ): boolean {
    return channel === 'email' ? preference.emailEnabled : preference.pushEnabled;
  }

  private async deliverEmail(
    userId: string,
    type: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    this.logger.log(`Delivering email notification to ${userId} (type=${type})`);
    void payload;
  }

  private async deliverPush(
    userId: string,
    type: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    this.logger.log(`Delivering push notification to ${userId} (type=${type})`);
    void payload;
  }
}
