import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AllowedAssetsCacheService } from './allowed-assets-cache.service';
import { RedisService } from './redis.service';

describe('AllowedAssetsCacheService', () => {
  let service: AllowedAssetsCacheService;
  let mockRedis: Partial<RedisService>;
  let mockConfig: Partial<ConfigService>;

  beforeEach(async () => {
    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    mockConfig = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, number> = {
          ALLOWED_ASSETS_REFRESH_INTERVAL_MS: 1000,
          ALLOWED_ASSETS_REFRESH_JITTER_MS: 200,
        };
        return values[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AllowedAssetsCacheService,
        { provide: RedisService, useValue: mockRedis },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(AllowedAssetsCacheService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Refresh interval jitter', () => {
    it('applies jitter to refresh interval', () => {
      jest.useFakeTimers();

      service.onModuleInit();

      // Collect multiple intervals to verify randomization
      const intervals: number[] = [];
      for (let i = 0; i < 5; i++) {
        const beforeTime = Date.now();
        jest.runOnlyPendingTimers();
        const afterTime = Date.now();
        intervals.push(afterTime - beforeTime);

        // Restart for next iteration
        service.onModuleInit();
      }

      intervals.forEach((interval) => {
        // Each interval should be: base (1000) + random jitter (0-200)
        expect(interval).toBeGreaterThanOrEqual(1000);
        expect(interval).toBeLessThanOrEqual(1200);
      });
    });

    it('varies refresh timing within configured jitter window', () => {
      jest.useFakeTimers();
      const baseInterval = 1000;
      const jitterMs = 200;

      service.onModuleInit();
      expect(jest.getTimerCount()).toBe(1);

      const beforeTime = Date.now();
      jest.runOnlyPendingTimers();
      const elapsed = Date.now() - beforeTime;

      expect(elapsed).toBeGreaterThanOrEqual(baseInterval);
      expect(elapsed).toBeLessThanOrEqual(baseInterval + jitterMs);

      jest.useRealTimers();
    });

    it('reschedules refresh after completion', async () => {
      jest.useFakeTimers();
      const setSpy = jest.spyOn(mockRedis, 'set' as any);

      service.onModuleInit();
      expect(jest.getTimerCount()).toBe(1);

      jest.runOnlyPendingTimers();
      // refresh() is async (awaits fetchAssets() then redis.set()); flush
      // the microtask queue so those awaited calls resolve before asserting.
      await Promise.resolve();
      await Promise.resolve();

      expect(setSpy).toHaveBeenCalled();

      // After refresh completes, a new timer should be scheduled. scheduleRefresh()
      // runs after the outer async callback's `await this.refresh()` resolves, one
      // more microtask tick beyond the redis.set() call above — flush a few more.
      await Promise.resolve();
      await Promise.resolve();
      expect(jest.getTimerCount()).toBeGreaterThan(0);

      jest.useRealTimers();
    });
  });

  describe('Cache invalidation', () => {
    it('stops refresh on module destroy', () => {
      jest.useFakeTimers();

      service.onModuleInit();
      expect(jest.getTimerCount()).toBe(1);

      service.onModuleDestroy();
      expect(jest.getTimerCount()).toBe(0);

      jest.useRealTimers();
    });

    it('allows manual cache invalidation', async () => {
      const delSpy = jest.spyOn(mockRedis, 'del' as any);

      await service.invalidate();

      expect(delSpy).toHaveBeenCalledWith('allowed:assets:v1');
    });
  });

  describe('Cache retrieval', () => {
    it('returns cached assets if available', async () => {
      const mockAssets = [
        { code: 'USD', issuer: 'GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIYHPDHE4ZIS5HECTI4CB3GCI7P', enabled: true },
      ];
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(mockAssets);

      const assets = await service.getAssets();

      expect(assets).toEqual(mockAssets);
    });

    it('fetches fresh assets if cache miss', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(null);

      const assets = await service.getAssets();

      expect(assets).toEqual([]);
    });
  });
});
