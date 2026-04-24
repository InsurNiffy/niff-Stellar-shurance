import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminPoliciesService } from './admin-policies.service';
import { AuditService } from './audit.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { QueueMonitorService } from '../queues/queue-monitor.service';
import { BullBoardMiddleware } from './bull-board.middleware';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    MaintenanceModule,
    RateLimitModule,
    MetricsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({ secret: cfg.get('JWT_SECRET') }),
    }),
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminPoliciesService, AuditService, QueueMonitorService],
  exports: [AuditService, QueueMonitorService],
})
export class AdminModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(BullBoardMiddleware)
      .forRoutes({ path: 'admin/queues*', method: RequestMethod.ALL });
  }
}
