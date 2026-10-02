/**
 * Issue #1453 — Bootstrap acceptance tests.
 *
 * Verifies: app boots, /v1/ping returns 200, unknown body fields are rejected
 * by the global ValidationPipe, and CORS blocks unknown origins.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:3000';
const BLOCKED_ORIGIN = 'http://evil.example.com';

describe('Bootstrap (issue #1453)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableCors({
      origin: ALLOWED_ORIGIN,
      credentials: true,
    });
    app.enableShutdownHooks();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/ping returns 200 with { status: "ok" }', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/ping');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('POST with unknown fields returns 400 (ValidationPipe forbidNonWhitelisted)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/challenge')
      .send({ publicKey: 'GBSEED000000000000000000000000000000000000000000000000001', unknownField: 'x' });
    expect(res.status).toBe(400);
  });

  it('CORS blocks a request from an unknown origin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/ping')
      .set('Origin', BLOCKED_ORIGIN);
    // The Access-Control-Allow-Origin header must not echo back the blocked origin.
    const acao = res.headers['access-control-allow-origin'];
    expect(acao).not.toBe(BLOCKED_ORIGIN);
  });

  it('CORS allows a request from the configured origin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/ping')
      .set('Origin', ALLOWED_ORIGIN);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });
});
