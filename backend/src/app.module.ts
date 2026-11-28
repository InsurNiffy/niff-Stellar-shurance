import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ClaimsModule } from './claims/claims.module';
import { QuoteModule } from './quote/quote.module';
import { PolicyModule } from './policy/policy.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TxModule } from './tx/tx.module';
import { Ch
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { AdminModule } from './admin/admin.module';
import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { HealthController } from './health/health.controller';
import { PrismaHealthIndicator } from './health/prisma.health';
import { RedisHealthIndicator } from './health/redis.health';
import { SorobanRpcHealthIndicator } from './health/soroban-rpc.health';
import { HorizonHealthIndicator } from './health/horizon.health';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TerminusModule.forRoot({ errorLogStyle: 'pretty' }),
    HttpModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    RequestContextMiddleware,
    AppLoggerService,
    PrismaHealthIndicator,
    RedisHealthIndicator,
    SorobanRpcHealthIndicator,
    HorizonHealthIndicator,
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
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
    {
      provide: APP_INTERCEPTOR,
      useClass: AddressNormalizeInterceptor,
    },
  ],
})
export class AppModule {}
