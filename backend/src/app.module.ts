import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { validateEnvironment } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { CacheModule } from './cache/cache.module';
import { RedisService } from './cache/redis.service';
import { RedisThrottlerStorage } from './common/guards/throttler-redis.storage';
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
import { ChainModule } from './chain/chain.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';
import { MetricsModule } from './metrics/metrics.module';
import { TenantModule } from './tenant/tenant.module';
import { GraphqlApiModule } from './graphql/graphql.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { EventsModule } from './events/events.module';
import { ProfileModule } from './profile/profile.module';
import { RampModule } from './ramp/ramp.module';
import { FeedsModule } from './feeds/feeds.module';
import { AssetsModule } from './assets/assets.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { AppLoggerService } from './common/logger/app-logger.service';
import { OracleHooksController } from './experimental/oracle-hooks.controller';
import { BetaCalculatorsController } from './experimental/beta-calculators.controller';
import { XdrDecodeController } from './experimental/xdr-decode.controller';
import { IdempotencyMiddleware } from './common/middleware/idempotency.middleware';
import { DeprecationHeadersInterceptor } from './common/versioning/deprecation-headers.interceptor';
import { V1SunsetInterceptor } from './common/versioning/v1-sunset.interceptor';
import { RejectUnversionedApiMiddleware } from './common/versioning/reject-unversioned-api.middleware';
import { LastSeenInterceptor } from './common/interceptors/last-seen.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { PostsModule } from './posts/posts.module';

/** Mutation routes that require idempotency key support (issue #363). */
const IDEMPOTENCY_ROUTES = [
  { path: 'claims', method: RequestMethod.POST },
  { path: 'policies', method: RequestMethod.POST },
  { path: 'tx/submit', method: RequestMethod.POST },
];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnvironment,
      validationOptions: {
        abortEarly: false,
      },
    }),
    ThrottlerModule.forRootAsync({
      imports: [CacheModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [
          // Global default: 120 req / 60 s per identity (wallet or IP)
          { name: 'default', ttl: 60_000, limit: 120 },
        ],
        storage: new RedisThrottlerStorage(redis) as unknown as ThrottlerStorage,
      }),
    }),
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
    ChainModule,
    FeatureFlagsModule,
    MetricsModule,
    TenantModule,
    GraphqlApiModule,
    MaintenanceModule,
    EventsModule,
    ProfileModule,
    RampModule,
    FeedsModule,
    AssetsModule,
    PostsModule,
  ],
  controllers: [OracleHooksController, BetaCalculatorsController, XdrDecodeController],
  providers: [
    RequestContextMiddleware,
    AppLoggerService,
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: DeprecationHeadersInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: V1SunsetInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LastSeenInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RejectUnversionedApiMiddleware).forRoutes('*');
    consumer.apply(RequestContextMiddleware).forRoutes('*');
    // Apply idempotency middleware to all mutation endpoints (issue #363)
    consumer.apply(IdempotencyMiddleware).forRoutes(...IDEMPOTENCY_ROUTES);
  }
}
