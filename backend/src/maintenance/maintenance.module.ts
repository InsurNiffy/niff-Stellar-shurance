import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { RpcModule } from '../rpc/rpc.module';
import { IpfsModule } from '../ipfs/ipfs.module';
import { MetricsModule } from '../metrics/metrics.module';
import { AuditService } from '../admin/audit.service';
import { WasmDriftService } from './wasm-drift.service';
import { WasmDriftJob } from './wasm-drift.job';
import { PrivacyService } from './privacy.service';
import { DataRetentionService } from './data-retention.service';
import { SolvencyMonitoringService } from './solvency-monitoring.service';
import { IpfsPinCheckJob } from './ipfs-pin-check.job';
import { VacuumService } from './vacuum.service';
import { VacuumJob } from './vacuum.job';
import { OutboundWebhookService } from '../webhooks/outbound-webhook.service';
import { VoteReconciliationJob } from './vote-reconciliation.job';
import { RampReconciliationService } from '../jobs/ramp-reconciliation.service';
import { RampHealthCheckService } from '../jobs/ramp-health-check.service';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, RpcModule, IpfsModule, MetricsModule],
  providers: [AuditService, WasmDriftService, WasmDriftJob, PrivacyService, DataRetentionService, SolvencyMonitoringService, IpfsPinCheckJob, VacuumService, VacuumJob, OutboundWebhookService, VoteReconciliationJob, RampReconciliationService, RampHealthCheckService],
  exports: [PrivacyService, SolvencyMonitoringService],
})
export class MaintenanceModule {}
