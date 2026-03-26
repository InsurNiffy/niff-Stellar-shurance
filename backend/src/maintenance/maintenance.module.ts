import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditService } from '../admin/audit.service';
import { WasmDriftService } from './wasm-drift.service';
import { PrivacyService } from './privacy.service';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule],
  providers: [AuditService, WasmDriftService, PrivacyService],
  exports: [PrivacyService],
})
export class MaintenanceModule {}
