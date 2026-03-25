import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsConsumer } from './notifications.consumer';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsConsumer],
  exports: [NotificationsService, NotificationsConsumer],
})
export class NotificationsModule {}
