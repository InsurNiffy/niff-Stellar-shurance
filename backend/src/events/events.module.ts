import { Module } from "@nestjs/common";
import { EventsController } from "./events.controller";
import { ClaimEventsService } from "./claim-events.service";
import { SseConnectionRegistry } from "./sse-connection.registry";
import { CacheModule } from "../cache/cache.module";

@Module({
  imports: [CacheModule],
  controllers: [EventsController],
  providers: [ClaimEventsService, SseConnectionRegistry],
  exports: [ClaimEventsService],
})
export class EventsModule {}
