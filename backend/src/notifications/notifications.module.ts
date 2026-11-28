import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsConsumer } from './notifications.consumer';
import { ClaimNotificationBatchService } from './claim-notification-batch.service';
import { NotificationDispatchService } from './notification-dispatch.service';
import {
  InMemoryNotificationPreferencesRepository,
  NOTIFICATION_PREFERENCES_REPOSITORY,
} from './notification-preferences.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { MetricsModule } from '../metrics/metrics.module';
import {
  NOTIFICATIONS_EMAIL_QUEUE,
  NOTIFICATIONS_PUSH_QUEUE,
  NotificationsEmailWorker,
  NotificationsPushWorker,
} from './notifications.worker';

@Module({
  imports: [
    PrismaModule,
    MetricsModule,
    BullModule.registerQueue(
      { name: NOTIFICATIONS_EMAIL_QUEUE },
      { name: NOTIFICATIONS_PUSH_QUEUE },
    ),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsConsumer,
    ClaimNotificationBatchService,
    NotificationDispatchService,
    NotificationsEmailWorker,
    NotificationsPushWorker,
    {
      provide: NOTIFICATION_PREFERENCES_REPOSITORY,
      useClass: InMemoryNotificationPreferencesRepository,
    },
  ],
  exports: [
    NotificationsService,
    NotificationsConsumer,
    ClaimNotificationBatchService,
    NotificationDispatchService,
    BullModule,
  ],
})
export class NotificationsModule {}
