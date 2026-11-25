import { Module } from '@nestjs/common';
import { ClaimsEventsController } from './claims-events.controller';

@Module({
  controllers: [ClaimsEventsController],
  exports: [ClaimsEventsController],
})
export class EventsModule {}
