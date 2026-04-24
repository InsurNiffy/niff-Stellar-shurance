import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PolicyController } from "./policy.controller";
import { PolicyService } from "./policy.service";
import { PolicyReadService } from "./policy-read.service";
import { RenewalController } from "./renewal.controller";
import { RenewalService } from "./renewal.service";
import { RenewalReminderService } from "./renewal-reminder.service";
import { RpcModule } from "../rpc/rpc.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TenantModule } from "../tenant/tenant.module";

@Module({
  imports: [ScheduleModule.forRoot(), RpcModule, NotificationsModule, TenantModule],
  controllers: [PolicyController, RenewalController],
  providers: [PolicyService, PolicyReadService, RenewalService, RenewalReminderService],
  exports: [PolicyService, PolicyReadService, RenewalService],
})
export class PolicyModule {}
