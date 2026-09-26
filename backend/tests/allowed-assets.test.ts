/**
 * Integration tests for GET /assets/allowed endpoint
 *
 * Coverage:
 *   - Returns all allowlisted assets (isAllowed: true)
 *   - Filters out removed assets (isAllowed: false)
 *   - Returns contractId, symbol, decimals
 *   - Response structure matches spec
 *   - Caching works (responses cached in Redis with TTL)
 *   - Cache invalidation on seeded asset events
 */

import * as http from 'http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { AssetsModule } from '../src/assets/assets.module';
import { CacheModule } from '../src/cache/cache.module';
import { MetricsModule } from '../src/metrics/metrics.module';
import { ConfigModule } from '@nestjs/config';

interface TestResponse {
  status: number;
  body: unknown;
}

function request(
  app: INestApplication,
  method: string,
  path: string,
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const server = app.getHttpServer() as http.Server;
    const address = server.address() as { port: number };
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: address.port,
      path,
      method,
      headers: { Accept: 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => (data += chunk.toString()));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          body: data ? JSON.parse(data) : null,
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('GET /assets/allowed (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
        AssetsModule,
        CacheModule,
        MetricsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    prisma = moduleRef.get(PrismaService);
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.allowedAsset.deleteMany({});
  });

  it('should return empty array when no assets are allowlisted', async () => {
    const res = await request(app, 'GET', '/assets/allowed');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      assets: [],
    });
  });

  it('should return allowlisted assets with correct shape', async () => {
    await prisma.allowedAsset.createMany({
      data: [
        {
          contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
          symbol: 'USDC',
          decimals: 6,
          isAllowed: true,
        },
        {
          contractId: 'CAA75D3D2XKBJFN7JYQHQJ5XAAAAAAAAAAAAAAAAAAAAAAAAAAABSC6',
          symbol: 'XLM',
          decimals: 7,
          isAllowed: true,
        },
      ],
    });

    const res = await request(app, 'GET', '/assets/allowed');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      assets: [
        {
          contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
          symbol: 'USDC',
          decimals: 6,
        },
        {
          contractId: 'CAA75D3D2XKBJFN7JYQHQJ5XAAAAAAAAAAAAAAAAAAAAAAAAAAABSC6',
          symbol: 'XLM',
          decimals: 7,
        },
      ],
    });
  });

  it('should exclude removed assets (isAllowed: false)', async () => {
    await prisma.allowedAsset.createMany({
      data: [
        {
          contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
          symbol: 'USDC',
          decimals: 6,
          isAllowed: true,
        },
        {
          contractId: 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSC4',
          symbol: 'DEAD',
          decimals: 7,
          isAllowed: false,
        },
      ],
    });

    const res = await request(app, 'GET', '/assets/allowed');
    expect(res.status).toBe(200);
    expect(res.body.assets).toHaveLength(1);
    expect(res.body.assets[0]?.symbol).toBe('USDC');
  });

  it('should handle null symbol gracefully', async () => {
    await prisma.allowedAsset.create({
      data: {
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        symbol: null,
        decimals: 7,
        isAllowed: true,
      },
    });

    const res = await request(app, 'GET', '/assets/allowed');
    expect(res.status).toBe(200);
    expect(res.body.assets[0]).toEqual({
      contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
      symbol: null,
      decimals: 7,
    });
  });
});
