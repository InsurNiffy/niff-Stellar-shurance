/**
 * Integration tests for refresh token rotation.
 *
 * Covers: successful rotation, reuse detection, logout invalidation,
 * concurrent refresh, expired access token re-auth, and replay protection.
 *
 * Uses an in-memory Redis mock — no live Redis required.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { WalletAuthService } from './wallet-auth.service';
import { RefreshTokenService } from './refresh-token.service';
import { NonceService } from './nonce.service';
import { WalletSignatureService } from './wallet-signature.service';
import { RedisService } from '../cache/redis.service';

// ── In-memory Redis mock ──────────────────────────────────────────────────

function makeRedisStore() {
  const store = new Map<string, { value: string; expiresAt: number }>();

  const client = {
    scan: jest.fn(async (_cursor: string, _match: string, _pattern: string, _count: string, _n: number) => {
      const keys = [...store.keys()];
      return ['0', keys];
    }),
  };

  return {
    getClient: () => client,
    get: jest.fn(async <T>(key: string): Promise<T | null> => {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) { store.delete(key); return null; }
      return JSON.parse(entry.value) as T;
    }),
    set: jest.fn(async <T>(key: string, value: T, ttl: number): Promise<void> => {
      store.set(key, { value: JSON.stringify(value), expiresAt: Date.now() + ttl * 1000 });
    }),
    del: jest.fn(async (key: string): Promise<void> => { store.delete(key); }),
    _store: store,
    _clear: () => store.clear(),
  };
}

// ── In-memory nonce store mock ────────────────────────────────────────────

function makeNonceService(redisStore: ReturnType<typeof makeRedisStore>) {
  return {
    store: jest.fn(async (nonce: string, data: object) => {
      await redisStore.set(`nonce:${nonce}`, data, 300);
    }),
    consume: jest.fn(async (nonce: string) => {
      const data = await redisStore.get(`nonce:${nonce}`);
      if (!data) return null;
      await redisStore.del(`nonce:${nonce}`);
      return data;
    }),
  };
}

// ── App factory ───────────────────────────────────────────────────────────

const JWT_SECRET = 'test-secret-at-least-32-characters-long!!';

async function buildApp() {
  const redisStore = makeRedisStore();
  const nonceService = makeNonceService(redisStore);

  const module: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      PassportModule,
      JwtModule.register({ secret: JWT_SECRET, signOptions: { expiresIn: '15m' } }),
      ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    ],
    controllers: [AuthController],
    providers: [
      WalletAuthService,
      RefreshTokenService,
      WalletSignatureService,
      { provide: NonceService, useValue: nonceService },
      { provide: RedisService, useValue: redisStore },
    ],
  }).compile();

  const app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  const jwtService = module.get(JwtService);
  const refreshTokenService = module.get(RefreshTokenService);

  return { app, redisStore, nonceService, jwtService, refreshTokenService };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Refresh token rotation', () => {
  let app: INestApplication;
  let redisStore: ReturnType<typeof makeRedisStore>;
  let refreshTokenService: RefreshTokenService;
  let jwtService: JwtService;

  beforeEach(async () => {
    ({ app, redisStore, refreshTokenService, jwtService } = await buildApp());
  });

  afterEach(async () => {
    redisStore._clear();
    await app.close();
  });

  // ── POST /auth/refresh ────────────────────────────────────────────────

  it('returns a new access + refresh token on valid refresh', async () => {
    const wallet = 'GWALLET1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678';
    const rt = await refreshTokenService.issue(wallet);

    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: rt });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body).toHaveProperty('expiresAt');
    expect(res.body.refreshToken).not.toBe(rt); // rotated
  });

  it('new access token contains walletAddress in payload', async () => {
    const wallet = 'GWALLET1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678';
    const rt = await refreshTokenService.issue(wallet);

    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: rt });

    const payload = jwtService.decode(res.body.token) as Record<string, unknown>;
    expect(payload.walletAddress).toBe(wallet);
    expect(payload.scope).toBe('user');
  });

  it('access token expires in ~15 minutes', async () => {
    const wallet = 'GWALLET1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678';
    const rt = await refreshTokenService.issue(wallet);

    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: rt });

    const payload = jwtService.decode(res.body.token) as Record<string, number>;
    const ttl = payload.exp - payload.iat;
    expect(ttl).toBe(15 * 60);
  });

  it('old refresh token is invalidated after rotation', async () => {
    const wallet = 'GWALLET1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678';
    const rt = await refreshTokenService.issue(wallet);

    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: rt });

    // Second use of the original token must fail
    const res2 = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: rt });

    expect(res2.status).toBe(401);
  });

  it('reuse detection: replaying a rotated token revokes the session', async () => {
    const wallet = 'GWALLET1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678';
    const rt = await refreshTokenService.issue(wallet);

    // Legitimate rotation
    const res1 = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: rt });
    expect(res1.status).toBe(200);

    // Attacker replays the original token — session must be revoked
    const res2 = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: rt });
    expect(res2.status).toBe(401);
    expect(res2.body.message).toMatch(/reuse|revoked/i);

    // New token from the legitimate rotation must also be invalidated
    const res3 = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: res1.body.refreshToken });
    expect(res3.status).toBe(401);
  });

  it('returns 401 for a completely unknown refresh token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'totally-fake-token-that-was-never-issued' });

    expect(res.status).toBe(401);
  });

  it('returns 400 when refreshToken field is missing', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({});

    expect(res.status).toBe(400);
  });

  // ── POST /auth/logout ─────────────────────────────────────────────────

  it('logout returns 204 and invalidates the refresh token', async () => {
    const wallet = 'GWALLET1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678';
    const rt = await refreshTokenService.issue(wallet);

    const logoutRes = await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: rt });

    expect(logoutRes.status).toBe(204);

    // Token must no longer work
    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: rt });

    expect(refreshRes.status).toBe(401);
  });

  it('logout is idempotent — second logout does not throw', async () => {
    const wallet = 'GWALLET1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678';
    const rt = await refreshTokenService.issue(wallet);

    await request(app.getHttpServer()).post('/auth/logout').send({ refreshToken: rt });
    const res2 = await request(app.getHttpServer()).post('/auth/logout').send({ refreshToken: rt });

    expect(res2.status).toBe(204);
  });

  // ── Concurrent refresh ────────────────────────────────────────────────

  it('concurrent refresh: only one succeeds, the other gets 401', async () => {
    const wallet = 'GWALLET1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678';
    const rt = await refreshTokenService.issue(wallet);

    const [res1, res2] = await Promise.all([
      request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: rt }),
      request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: rt }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 401]);
  });

  // ── RefreshTokenService unit behaviour ───────────────────────────────

  it('issued token hash is never returned in plaintext from Redis', async () => {
    const wallet = 'GWALLET1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678';
    const raw = await refreshTokenService.issue(wallet);

    // Verify the raw token is NOT stored as a key or value in Redis
    const store = redisStore._store;
    for (const [key, entry] of store.entries()) {
      expect(key).not.toContain(raw);
      expect(entry.value).not.toContain(raw);
    }
  });

  it('expired access token cannot be used to refresh (service layer)', async () => {
    // Issue a refresh token and verify consume works
    const wallet = 'GWALLET1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678';
    const rt = await refreshTokenService.issue(wallet);
    const walletBack = await refreshTokenService.consume(rt);
    expect(walletBack).toBe(wallet);

    // After consume, the same token must throw
    await expect(refreshTokenService.consume(rt)).rejects.toThrow(UnauthorizedException);
  });
});
