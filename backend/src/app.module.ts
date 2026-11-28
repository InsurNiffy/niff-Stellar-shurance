import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { AdminModule } from './admin/admin.module';
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
    PrismaHealthIndicator,
    RedisHealthIndicator,
    SorobanRpcHealthIndicator,
    HorizonHealthIndicator,
  ],
})
export class AppModule {}
