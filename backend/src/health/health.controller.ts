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
import { TlsCertificateMonitorService } from '../tls/tls-certificate-monitor.service';

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

const DEFAULT_TIMEOUT_MS = 3_000;

function resolveTimeout(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly dbTimeoutMs = resolveTimeout(
    process.env.HEALTH_DB_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
  );
  private readonly redisTimeoutMs = resolveTimeout(
    process.env.HEALTH_REDIS_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
  );
  private readonly rpcTimeoutMs = resolveTimeout(
    process.env.HEALTH_RPC_TIMEOUT_MS,
    5_000,
  );
  private readonly horizonTimeoutMs = resolveTimeout(
    process.env.HEALTH_HORIZON_TIMEOUT_MS,
    5_000,
  );

  constructor(
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly rpcHealth: SorobanRpcHealthIndicator,
    private readonly horizonHealth: HorizonHealthIndicator,
    private readonly indexerHealth: IndexerHealthIndicator,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly tlsMonitor?: TlsCertificateMonitorService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — process is up' })
  @ApiResponse({ status: 200, description: 'Process is running' })
  live(@Res() res: Response): void {
    res.status(200).json({ status: 'up' });
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — critical dependencies reachable' })
  @ApiResponse({ status: 200, description: 'Ready to serve traffic' })
  @ApiResponse({ status: 503, description: 'Not ready' })
  async ready(@Res() res: Response): Promise<void> {
    const [db, redis, rpc, horizon, tls] = await Promise.all([
      runProbe(async () => {
        await this.prismaHealth.isHealthy('db');
        return { status: 'up' as const };
      }, this.dbTimeoutMs),
      runProbe(async () => {
        const up = await checkRedisHealth();
        return { status: (up ? 'up' : 'down') as ComponentStatus };
    const [db, redis, rpc, horizon, tls] = await Promise.all([
      runProbe(async () => {
        await this.prismaHealth.isHealthy('db');
        return { status: 'up' as const };
      }, this.dbTimeoutMs),
      runProbe(async () => {
        const up = await checkRedisHealth();
        return { status: (up ? 'up' : 'down') as ComponentStatus };
      }, this.redisTimeoutMs),
      runProbe(async () => {
        await this.rpcHealth.isHealthy('rpc');
        return { status: 'up' as const };
      }, this.rpcTimeoutMs),
      this.horizonHealth.check(this.horizonTimeoutMs),
      this.checkTlsCertificates(),
    ]);

    const ready =
      db.status === 'up' &&
      redis.status === 'up' &&
      rpc.status === 'up' &&
      horizon.status === 'up' &&
      tls.status !== 'down';
    res.status(ready ? 200 : 503).json({
      status: ready ? 'up' : 'down',
      components: { db, redis, rpc, horizon, tls },
    });
  }

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
      }, this.dbTimeoutMs),
      runProbe(async () => {
        const up = await checkRedisHealth();
        return { status: (up ? 'up' : 'down') as ComponentStatus };
      }, this.redisTimeoutMs),
      runProbe(async () => {
        await this.rpcHealth.isHealthy('rpc');
        return { status: 'up' as const };
      }, this.rpcTimeoutMs),
      this.horizonHealth.check(this.horizonTimeoutMs),
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

  private async checkTlsCertificates(): Promise<ComponentResult> {
    const monitor = this.tlsMonitor;
    if (!monitor) {
      return { status: 'up' as const };
    }

    return runProbe(async () => {
      const summary = await monitor.getStatusSummary();
      return {
        status: summary.status,
        reason: summary.reason,
      };
    }, 5_000);
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
    }, this.dbTimeoutMs);
  }
}
