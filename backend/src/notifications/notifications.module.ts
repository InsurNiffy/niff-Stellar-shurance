import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsConsumer } from './notifications.consumer';
import {
  InMemoryNotificationPreferencesRepository,
  NOTIFICATION_PREFERENCES_REPOSITORY,
} from './notification-preferences.repository';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsConsumer,
    {
      provide: NOTIFICATION_PREFERENCES_REPOSITORY,
      useClass: InMemoryNotificationPreferencesRepository,
    },
  ],
  exports: [NotificationsService, NotificationsConsumer],
})
export class NotificationsModule {}
