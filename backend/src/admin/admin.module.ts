import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminPoliciesService } from './admin-policies.service';
import { AdminClaimsExportService } from './admin-claims-export.service';
import { AdminTenantsService } from './admin-tenants.service';
import { AdminStatsService } from './admin-stats.service';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AuditService } from './audit.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { QueueMonitorService } from '../queues/queue-monitor.service';
import { BullBoardMiddleware } from './bull-board.middleware';
import { AllowlistMiddleware } from './middleware/allowlist.middleware';
import { MetricsModule } from '../metrics/metrics.module';
import { CacheModule } from '../cache/cache.module';
import { RpcModule } from '../rpc/rpc.module';
import { SupportModule } from '../support/support.module';
import { CommentRepository } from '../claims/comments/comment.repository';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    MaintenanceModule,
    RateLimitModule,
    MetricsModule,
    CacheModule,
    RpcModule,
    SupportModule,
    TenantModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({ secret: cfg.get('JWT_SECRET') }),
    }),
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminPoliciesService, AdminClaimsExportService, AdminTenantsService, AdminStatsService, AdminAnalyticsService, AuditService, QueueMonitorService, CommentRepository],
  exports: [AuditService, QueueMonitorService],
})
export class AdminModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // IP allowlist runs before auth guards to fail closed for blocked IPs
    consumer
      .apply(AllowlistMiddleware)
      .forRoutes({ path: 'admin*', method: RequestMethod.ALL });

    consumer
      .apply(BullBoardMiddleware)
      .forRoutes({ path: 'admin/queues*', method: RequestMethod.ALL });
  }
}
