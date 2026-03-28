import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditService } from '../admin/audit.service';
import { WasmDriftService } from './wasm-drift.service';
import { PrivacyService } from './privacy.service';
import { DataRetentionService } from './data-retention.service';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule],
  providers: [AuditService, WasmDriftService, PrivacyService, DataRetentionService],
  exports: [PrivacyService],
})
export class MaintenanceModule {}
