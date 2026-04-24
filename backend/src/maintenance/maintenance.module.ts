import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { RpcModule } from '../rpc/rpc.module';
import { AuditService } from '../admin/audit.service';
import { WasmDriftService } from './wasm-drift.service';
import { PrivacyService } from './privacy.service';
import { DataRetentionService } from './data-retention.service';
import { SolvencyMonitoringService } from './solvency-monitoring.service';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, RpcModule],
  providers: [AuditService, WasmDriftService, PrivacyService, DataRetentionService, SolvencyMonitoringService],
  exports: [PrivacyService, SolvencyMonitoringService],
})
export class MaintenanceModule {}
