import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsConsumer } from './notifications.consumer';
import { ClaimNotificationBatchService } from './claim-notification-batch.service';
import {
  InMemoryNotificationPreferencesRepository,
  NOTIFICATION_PREFERENCES_REPOSITORY,
} from './notification-preferences.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [PrismaModule, MetricsModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsConsumer,
    ClaimNotificationBatchService,
    {
      provide: NOTIFICATION_PREFERENCES_REPOSITORY,
      useClass: InMemoryNotificationPreferencesRepository,
    },
  ],
  exports: [NotificationsService, NotificationsConsumer, ClaimNotificationBatchService],
})
export class NotificationsModule {}
