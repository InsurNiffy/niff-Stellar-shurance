/**
 * API URI versioning integration tests (issue #649, #890).
 */
import { Controller, Get, INestApplication, Module, VersioningType } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DeprecatedApi } from '../deprecated-api.decorator';
import { DeprecationHeadersInterceptor } from '../deprecation-headers.interceptor';
import { V1SunsetInterceptor } from '../v1-sunset.interceptor';
import { RejectUnversionedApiMiddleware } from '../reject-unversioned-api.middleware';
import {
  DEPRECATION_HEADER,
  DEPRECATED_API_SUNSET_HTTP_DATE,
  SUNSET_HEADER,
} from '../api-versioning.constants';

@Controller('health')
class HealthProbeController {
  @Get()
  check() {
    return { ok: true };
  }
}

@DeprecatedApi()
@Controller('experimental/legacy')
class LegacyExperimentalController {
  @Get()
  legacy() {
    return { legacy: true };
  }
}

@Module({
  controllers: [HealthProbeController, LegacyExperimentalController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: DeprecationHeadersInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: V1SunsetInterceptor,
    },
  ],
})
class VersioningTestModule {}

describe('API versioning (integration)', () => {
  let app: INestApplication;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [VersioningTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.use(new RejectUnversionedApiMiddleware().use.bind(new RejectUnversionedApiMiddleware()));
    await app.init();
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    if (app) {
      await app.close();
    }
  });

  it('serves routes under /api/v1/', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('returns 404 for non-versioned API paths in production', async () => {
    process.env.NODE_ENV = 'production';
    const response = await request(app.getHttpServer()).get('/api/health');
    expect(response.status).toBe(404);
  });

  it('adds Deprecation and Sunset headers on deprecated routes', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/experimental/legacy',
    );
    expect(response.status).toBe(200);
    expect(response.headers[DEPRECATION_HEADER.toLowerCase()]).toBe('true');
    expect(response.headers[SUNSET_HEADER.toLowerCase()]).toBe(
      DEPRECATED_API_SUNSET_HTTP_DATE,
    );
  });

  it('adds Sunset and Deprecation headers to all v1 endpoints (#890)', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.headers[DEPRECATION_HEADER.toLowerCase()]).toBe('true');
    expect(response.headers[SUNSET_HEADER.toLowerCase()]).toBe(
      DEPRECATED_API_SUNSET_HTTP_DATE,
    );
  });
});
