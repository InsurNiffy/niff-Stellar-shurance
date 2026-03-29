import { Module } from "@nestjs/common";
import { HorizonController } from "./horizon.controller";
import { HorizonService } from "./horizon.service";
import { HorizonRateLimitService } from "./horizon-rate-limit.service";
import { CacheModule } from "../cache/cache.module";

@Module({
  imports: [CacheModule],
  controllers: [HorizonController],
  providers: [HorizonService, HorizonRateLimitService],
})
export class HorizonModule {}
