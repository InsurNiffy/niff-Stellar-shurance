import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerModule } from '@nestjs/throttler';
import { validationSchema } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { CacheModule } from './cache/cache.module';
import { RpcModule } from './rpc/rpc.module';
import { IndexerModule } from './indexer/indexer.module';
import { IpfsModule } from './ipfs/ipfs.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { ClaimsModule } from './claims/claims.module';
import { QuoteModule } from './quote/quote.module';
import { PolicyModule } from './policy/policy.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TxModule } from './tx/tx.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';
import { MetricsModule } from './metrics/metrics.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { AppLoggerService } from './common/logger/app-logger.service';
import { OracleHooksController } from './experimental/oracle-hooks.controller';
import { BetaCalculatorsController } from './experimental/beta-calculators.controller';
import { IdempotencyMiddleware } from './common/middleware/idempotency.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema,
      validationOptions: {
        abortEarly: true,
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    TerminusModule,
    PrismaModule,
    CacheModule,
    HealthModule,
    RpcModule,
    IndexerModule,
    IpfsModule,
    AuthModule,
    AdminModule,
    ClaimsModule,
    QuoteModule,
    PolicyModule,
    NotificationsModule,
    TxModule,
    FeatureFlagsModule,
    MetricsModule,
  ],
  controllers: [OracleHooksController, BetaCalculatorsController],
  providers: [RequestContextMiddleware, AppLoggerService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
