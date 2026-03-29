/**
 * Integration-style tests: QuoteService + QuoteSimulationCacheService + in-memory Redis mock (TTL expiry).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { QuoteService } from './quote.service';
import { QuoteSimulationCacheService } from './quote-simulation-cache.service';
import { SorobanService } from '../rpc/soroban.service';
import { RedisService } from '../cache/redis.service';
import { MetricsService } from '../metrics/metrics.service';
import {
  CoverageTierEnum,
  PolicyTypeEnum,
  RegionTierEnum,
} from './dto/generate-premium.dto';

const SOURCE_ACCOUNT =
  'GBCPNZ6S7RK5N4BX6HBXBCX7P5QNBOJZFGDWBZBXCLK5T6KHWOPTLR3I';

function createTtlRedisMock() {
  const store = new Map<string, { json: string; expiresAt: number }>();
  return {
    get: jest.fn(async <T>(key: string): Promise<T | null> => {
      const e = store.get(key);
      if (!e || Date.now() >= e.expiresAt) {
        store.delete(key);
        return null;
      }
      return JSON.parse(e.json) as T;
    }),
    set: jest.fn(async (key: string, value: unknown, ttlSeconds: number) => {
      store.set(key, {
        json: JSON.stringify(value),
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    delPattern: jest.fn(async (pattern: string) => {
      const prefix = pattern.replace(/\*$/, '');
      for (const k of [...store.keys()]) {
        if (k.startsWith(prefix)) store.delete(k);
      }
    }),
    getClient: jest.fn(),
    ping: jest.fn(async () => true),
    onModuleDestroy: jest.fn(),
  };
}

function testDto(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    policy_type: PolicyTypeEnum.Auto,
    region: RegionTierEnum.Low,
    coverage_tier: CoverageTierEnum.Basic,
    age: 30,
    risk_score: 5,
    source_account: SOURCE_ACCOUNT,
    ...overrides,
  };
}

async function createQuoteTestModule(
  redis: ReturnType<typeof createTtlRedisMock>,
  ttlSeconds = 30,
): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [
          () => ({
            REDIS_URL: 'redis://mock:6379',
            CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
            STELLAR_NETWORK_PASSPHRASE: 'Integration Test Network',
            QUOTE_SIMULATION_CACHE_ENABLED: 'true',
            QUOTE_SIMULATION_CACHE_TTL_SECONDS: ttlSeconds,
          }),
        ],
      }),
    ],
    providers: [
      QuoteService,
      QuoteSimulationCacheService,
      { provide: RedisService, useValue: redis },
      MetricsService,
      {
        provide: SorobanService,
        useValue: {
          simulateGeneratePremium: jest.fn().mockResolvedValue({
            premiumStroops: '424242',
            premiumXlm: '0.0424242',
            minResourceFee: '99',
            source: 'simulation',
          }),
        },
      },
    ],
  }).compile();
}

describe('Quote simulation cache (integration)', () => {
  let redis: ReturnType<typeof createTtlRedisMock>;
  let moduleRef: TestingModule;
  let quoteService: QuoteService;
  let soroban: { simulateGeneratePremium: jest.Mock };
  let metrics: MetricsService;

  beforeEach(async () => {
    redis = createTtlRedisMock();
    moduleRef = await createQuoteTestModule(redis, 30);
    quoteService = moduleRef.get(QuoteService);
    soroban = moduleRef.get(SorobanService) as {
      simulateGeneratePremium: jest.Mock;
    };
    metrics = moduleRef.get(MetricsService);
    jest.spyOn(metrics, 'recordQuoteSimulationCache').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await moduleRef.close();
  });

  it('second identical request is a cache hit (single RPC)', async () => {
    const dto = testDto();
    const a = await quoteService.getQuote(dto);
    const b = await quoteService.getQuote(dto);

    expect(a.premiumStroops).toBe('424242');
    expect(b.premiumStroops).toBe('424242');
    expect(soroban.simulateGeneratePremium).toHaveBeenCalledTimes(1);
    expect(metrics.recordQuoteSimulationCache).toHaveBeenCalledWith('miss');
    expect(metrics.recordQuoteSimulationCache).toHaveBeenCalledWith('hit');
  });

  it('Cache-Control path bypasses cache (two RPC calls)', async () => {
    const dto = testDto();
    await quoteService.getQuote(dto, { bypassCache: true });
    await quoteService.getQuote(dto, { bypassCache: true });

    expect(soroban.simulateGeneratePremium).toHaveBeenCalledTimes(2);
    expect(metrics.recordQuoteSimulationCache).toHaveBeenCalledWith('bypass');
  });

  it('does not cache local_fallback simulation results', async () => {
    soroban.simulateGeneratePremium.mockResolvedValue({
      premiumStroops: '1',
      premiumXlm: '0.0000001',
      minResourceFee: '0',
      source: 'local_fallback',
    });
    const dto = testDto();
    await quoteService.getQuote(dto);
    await quoteService.getQuote(dto);

    expect(soroban.simulateGeneratePremium).toHaveBeenCalledTimes(2);
  });

  it('expires after TTL and misses again', async () => {
    await moduleRef.close();
    const r = createTtlRedisMock();
    moduleRef = await createQuoteTestModule(r, 1);
    quoteService = moduleRef.get(QuoteService);
    soroban = moduleRef.get(SorobanService) as {
      simulateGeneratePremium: jest.Mock;
    };
    soroban.simulateGeneratePremium.mockResolvedValue({
      premiumStroops: '999',
      premiumXlm: '0.0000999',
      minResourceFee: '1',
      source: 'simulation',
    });

    const dto = testDto({ risk_score: 7 });
    await quoteService.getQuote(dto);
    await new Promise((res) => setTimeout(res, 1200));
    await quoteService.getQuote(dto);

    expect(soroban.simulateGeneratePremium).toHaveBeenCalledTimes(2);
  });
});
