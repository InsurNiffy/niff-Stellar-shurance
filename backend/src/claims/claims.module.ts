import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { SanitizationService } from './sanitization.service';
import { ClaimViewMapper } from './claim-view.mapper';
import { ClaimAggregationService } from './services/claim-aggregation.service';
import { ClaimSummaryCacheService } from './services/claim-summary-cache.service';
import { EvidenceUploadService } from './services/evidence-upload.service';
import { EvidenceProxyService } from './services/evidence-proxy.service';
import { ClaimDeadlineProcessorService } from './claim-deadline.processor.service';
import { ClaimDeadlineBootstrap } from './claim-deadline.bootstrap';
import { ClaimHistoryService } from './services/claim-history.service';
import { AppealSimulationCacheService } from './services/appeal-simulation-cache.service';
import { RpcModule } from '../rpc/rpc.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantModule } from '../tenant/tenant.module';
import { IndexerModule } from '../indexer/indexer.module';
import { CacheModule } from '../cache/cache.module';
import { PrismaModule } from '../prisma/prisma.module';
import { IpfsModule } from '../ipfs/ipfs.module';
import { AdminModule } from '../admin/admin.module';
import { MetricsModule } from '../metrics/metrics.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    RpcModule,
    RateLimitModule,
    TenantModule,
    IndexerModule,
    CacheModule,
    IpfsModule,
    AdminModule,
    MetricsModule,
    FeatureFlagsModule,
    NotificationsModule,
  ],
  controllers: [ClaimsController],
  providers: [
    ClaimsService,
    SanitizationService,
    ClaimViewMapper,
    ClaimAggregationService,
    ClaimSummaryCacheService,
    EvidenceUploadService,
    EvidenceProxyService,
    ClaimDeadlineProcessorService,
    ClaimDeadlineBootstrap,
    ClaimHistoryService,
    AppealSimulationCacheService,
  ],
  exports: [
    ClaimsService,
    ClaimViewMapper,
    ClaimAggregationService,
    ClaimSummaryCacheService,
    ClaimDeadlineProcessorService,
  ],
})
export class ClaimsModule {}
