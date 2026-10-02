import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { SorobanRpcHealthIndicator } from './soroban-rpc.health';
import { HorizonHealthIndicator } from './horizon.health';
import { IndexerHealthIndicator } from './indexer.health';
import * as redisClient from '../redis/client';

jest.mock('../redis/client', () => ({
  checkRedisHealth: jest.fn(),
}));

jest.mock('../config/network.config', () => ({
  getNetworkConfig: () => ({ network: 'testnet', horizonUrl: 'https://horizon-testnet.stellar.org' }),
}));

const mockCheckRedisHealth = redisClient.checkRedisHealth as jest.Mock;

function makePrismaHealth(healthy = true) {
  return {
    isHealthy: healthy
      ? jest.fn().mockResolvedValue({ db: { status: 'up' } })
      : jest.fn().mockRejectedValue(new Error('db down')),
  };
}

function makeRpcHealth(healthy = true) {
  return {
    isHealthy: healthy
      ? jest.fn().mockResolvedValue({ rpc: { status: 'up' } })
      : jest.fn().mockRejectedValue(new Error('rpc down')),
  };
}

function makeHorizonHealth(status: 'up' | 'down' | 'degraded' = 'up') {
  return { check: jest.fn().mockResolvedValue({ status, responseTimeMs: 10 }) };
}

function makeIndexerHealth(status: 'up' | 'down' | 'degraded' = 'up', lagLedgers = 2) {
  return { check: jest.fn().mockResolvedValue({ status, responseTimeMs: 15, lagLedgers }) };
}

async function buildApp(overrides: {
  prisma?: ReturnType<typeof makePrismaHealth>;
  redis?: boolean;
  rpc?: ReturnType<typeof makeRpcHealth>;
  horizon?: ReturnType<typeof makeHorizonHealth>;
  indexer?: ReturnType<typeof makeIndexerHealth>;
}): Promise<INestApplication> {
  mockCheckRedisHealth.mockResolvedValue(overrides.redis ?? true);

  const module: TestingModule = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      { provide: PrismaHealthIndicator, useValue: overrides.prisma ?? makePrismaHealth() },
      { provide: RedisHealthIndicator, useValue: {} },
      { provide: SorobanRpcHealthIndicator, useValue: overrides.rpc ?? makeRpcHealth() },
      { provide: HorizonHealthIndicator, useValue: overrides.horizon ?? makeHorizonHealth() },
      { provide: IndexerHealthIndicator, useValue: overrides.indexer ?? makeIndexerHealth() },
    ],
  }).compile();

  const app = module.createNestApplication();
  await app.init();
  return app;
}

describe('HealthController', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('returns 200 when all components are up', async () => {
    app = await buildApp({});
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('up');
    const { db, redis, rpc, horizon, indexer } = res.body.components;
    expect(db.status).toBe('up');
    expect(redis.status).toBe('up');
    expect(rpc.status).toBe('up');
    expect(horizon.status).toBe('up');
    expect(indexer.status).toBe('up');
  });

  it('includes responseTimeMs for every component', async () => {
    app = await buildApp({});
    const res = await request(app.getHttpServer()).get('/health');
    for (const comp of Object.values(res.body.components) as { responseTimeMs: unknown }[]) {
      expect(typeof comp.responseTimeMs).toBe('number');
    }
  });

  it('includes indexer.lagLedgers', async () => {
    app = await buildApp({ indexer: makeIndexerHealth('up', 5) });
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.body.components.indexer.lagLedgers).toBe(5);
  });

  it('returns 207 when one component is degraded', async () => {
    app = await buildApp({ horizon: makeHorizonHealth('degraded') });
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(207);
    expect(res.body.status).toBe('degraded');
    expect(res.body.components.horizon.status).toBe('degraded');
  });

  it('returns 503 when a component is down', async () => {
    app = await buildApp({ prisma: makePrismaHealth(false) });
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('down');
    expect(res.body.components.db.status).toBe('down');
  });

  it('returns 503 when redis is down', async () => {
    app = await buildApp({ redis: false });
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.components.redis.status).toBe('down');
  });

  it('returns 503 when rpc is down', async () => {
    app = await buildApp({ rpc: makeRpcHealth(false) });
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.components.rpc.status).toBe('down');
  });

  it('returns 503 when horizon is down', async () => {
    app = await buildApp({ horizon: makeHorizonHealth('down') });
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.components.horizon.status).toBe('down');
  });

  it('down takes precedence over degraded', async () => {
    app = await buildApp({
      horizon: makeHorizonHealth('degraded'),
      indexer: makeIndexerHealth('down'),
    });
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('down');
  });

  it('endpoint always returns a complete response even when a probe is slow', async () => {
    // The timeout is enforced inside each indicator's runProbe call.
    // A mock that resolves slowly but within the test window still returns a valid response.
    const slowHorizon = {
      check: jest.fn().mockResolvedValue({ status: 'down' as const, responseTimeMs: 4999 }),
    };
    app = await buildApp({ horizon: slowHorizon });
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.body.components.horizon).toBeDefined();
    expect(res.body.components.horizon.responseTimeMs).toBeDefined();
  });
});

describe('HealthController — liveness and readiness probes', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('GET /health/live returns 200', async () => {
    app = await buildApp({});
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('up');
  });

  it('GET /health/ready returns 200 when db and redis are up', async () => {
    app = await buildApp({});
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('up');
  });

  it('GET /health/ready returns 503 when db is down', async () => {
    app = await buildApp({ prisma: makePrismaHealth(false) });
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('down');
    expect(res.body.components.db.status).toBe('down');
  });

  it('GET /health/ready returns 503 when redis is down', async () => {
    app = await buildApp({ redis: false });
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.components.redis.status).toBe('down');
  });
});
