import { Controller, Get, Res, Optional } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { SorobanRpcHealthIndicator } from './soroban-rpc.health';
import { HorizonHealthIndicator } from './horizon.health';
import { IndexerHealthIndicator } from './indexer.health';
import { runProbe, ComponentStatus, ProbeResult } from './probes';
import { checkRedisHealth } from '../redis/client';
import { PrismaService } from '../prisma/prisma.service';

interface ComponentResult extends ProbeResult {
  lagLedgers?: number;
}

interface HealthResponse {
  status: ComponentStatus;
  components: {
    db: ComponentResult;
    redis: ComponentResult;
    rpc: ComponentResult;
    horizon: ComponentResult;
    indexer: ComponentResult;
    ramp?: ComponentResult;
  };
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly rpcHealth: SorobanRpcHealthIndicator,
    private readonly horizonHealth: HorizonHealthIndicator,
    private readonly indexerHealth: IndexerHealthIndicator,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Component-level health check' })
  @ApiResponse({ status: 200, description: 'All components healthy' })
  @ApiResponse({ status: 207, description: 'One or more components degraded' })
  @ApiResponse({ status: 503, description: 'One or more critical components down' })
  async check(@Res() res: Response): Promise<void> {
    const [db, redis, rpc, horizon, indexer, ramp] = await Promise.all([
      runProbe(async () => {
        await this.prismaHealth.isHealthy('db');
        return { status: 'up' as const };
      }, 3_000),
      runProbe(async () => {
        const up = await checkRedisHealth();
        return { status: (up ? 'up' : 'down') as ComponentStatus };
      }, 3_000),
      runProbe(async () => {
        await this.rpcHealth.isHealthy('rpc');
        return { status: 'up' as const };
      }, 5_000),
      this.horizonHealth.check(),
      this.indexerHealth.check(),
      this.checkRampProviderHealth(),
    ]);

    const components: HealthResponse['components'] = { db, redis, rpc, horizon, indexer };
    if (ramp) {
      components.ramp = ramp;
    }

    const statuses = Object.values(components).map((c) => c.status);

    let overallStatus: ComponentStatus = 'up';
    if (statuses.some((s) => s === 'down')) {
      overallStatus = 'down';
    } else if (statuses.some((s) => s === 'degraded')) {
      overallStatus = 'degraded';
    }

    const body: HealthResponse = { status: overallStatus, components };

    const httpStatus = overallStatus === 'up' ? 200 : overallStatus === 'degraded' ? 207 : 503;
    res.status(httpStatus).json(body);
  }

  private async checkRampProviderHealth(): Promise<ComponentResult | undefined> {
    const prisma = this.prisma;
    if (!prisma) return undefined;

    return runProbe(async () => {
      const lastHealth = await prisma.rampProviderHealth.findFirst({
        orderBy: { createdAt: 'desc' },
        take: 1,
      });

      if (!lastHealth) {
        return { status: 'down' as const, reason: 'No health data available' };
      }

      return { status: lastHealth.status as ComponentStatus };
    }, 3_000);
  }
}
