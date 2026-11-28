import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { RpcModule } from '../rpc/rpc.module';
import { PrismaModule } from '../prisma/prisma.module';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { SorobanRpcHealthIndicator } from './soroban-rpc.health';
import { HorizonHealthIndicator } from './horizon.health';
import { IndexerHealthIndicator } from './indexer.health';
import { HealthMetricsService } from './health-metrics.service';

@Module({
  imports: [TerminusModule, RpcModule, PrismaModule],
  controllers: [HealthController],
  providers: [
    PrismaHealthIndicator,
    RedisHealthIndicator,
    SorobanRpcHealthIndicator,
    HorizonHealthIndicator,
    IndexerHealthIndicator,
    HealthMetricsService,
  ],
  exports: [HealthMetricsService],
})
export class HealthModule {}
