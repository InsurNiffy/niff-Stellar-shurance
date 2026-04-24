import { PostgreSqlContainer, StartedPostgreSqlContainer } from 'testcontainers';
import { RedisContainer, StartedRedisContainer } from 'testcontainers';
import { execSync } from 'child_process';
import * as path from 'path';

declare global {
   
  var __PG_CONTAINER__: StartedPostgreSqlContainer;
   
  var __REDIS_CONTAINER__: StartedRedisContainer;
}

export default async function globalSetup() {
  // Start containers in parallel
  const [pg, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('niffyinsure_e2e')
      .withUsername('e2e')
      .withPassword('e2e_pass')
      .start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);

  global.__PG_CONTAINER__ = pg;
  global.__REDIS_CONTAINER__ = redis;

  const databaseUrl = `postgresql://e2e:e2e_pass@${pg.getHost()}:${pg.getMappedPort(5432)}/niffyinsure_e2e`;
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}/0`;

  // Inject ephemeral credentials — no secrets in config files
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0'; // NestJS will bind to a random port per test file
  process.env.JWT_SECRET = 'e2e-test-secret-at-least-32-chars!!';
  process.env.ADMIN_TOKEN = 'e2e-admin-token';
  process.env.FRONTEND_ORIGINS = 'http://localhost:3001';
  process.env.ADMIN_CORS_ORIGINS = '';
  process.env.SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';
  process.env.IPFS_PROVIDER = 'mock';
  process.env.CAPTCHA_SECRET_KEY = 'dev-skip';
  process.env.LOG_LEVEL = 'error'; // suppress noise in CI output

  // Run Prisma migrations against the ephemeral DB
  const backendDir = path.resolve(__dirname, '..');
  execSync('npx prisma migrate deploy', {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  // Seed minimal data: one policy so the public read endpoint returns 200
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await prisma.policy.upsert({
      where: { id: 'GBSEED000000000000000000000000000000000000000000000000001:1' },
      update: {},
      create: {
        id: 'GBSEED000000000000000000000000000000000000000000000000001:1',
        policyId: 1,
        holderAddress: 'GBSEED000000000000000000000000000000000000000000000000001',
        policyType: 'CROP',
        region: 'US-IA',
        coverageAmount: '1000000',
        premium: '10000',
        isActive: true,
        startLedger: 1000,
        endLedger: 9999,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}
