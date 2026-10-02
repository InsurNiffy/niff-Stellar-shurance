import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service';
import { RedisService } from './redis.service';

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  delPattern: jest.fn(),
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
  waitForLock: jest.fn(),
};

const mockConfig = {
  get: jest.fn((key: string, fallback?: unknown) => {
    if (key === 'NODE_ENV') return 'test';
    if (key === 'APP_NAME') return 'niffy';
    return fallback;
  }),
};

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: RedisService, useValue: mockRedis },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);
  });

  describe('buildKey', () => {
    it('builds key without tenant', () => {
      expect(service.buildKey('policy:1')).toBe('niffy:test:policy:1');
    });

    it('builds key with tenant', () => {
      expect(service.buildKey('policy:1', 'acme')).toBe('niffy:test:acme:policy:1');
    });
  });

  describe('get', () => {
    it('returns cached value on hit', async () => {
      mockRedis.get.mockResolvedValueOnce({ id: 1 });
      const result = await service.get<{ id: number }>('policy:1');
      expect(result).toEqual({ id: 1 });
    });

    it('returns null on miss', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      const result = await service.get('policy:1');
      expect(result).toBeNull();
    });

    it('returns null when Redis is down', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const result = await service.get('policy:1');
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('calls redis.set with full key and ttl', async () => {
      mockRedis.set.mockResolvedValueOnce(undefined);
      await service.set('policy:1', { id: 1 }, 30);
      expect(mockRedis.set).toHaveBeenCalledWith('niffy:test:policy:1', { id: 1 }, 30);
    });

    it('does not throw when Redis is down', async () => {
      mockRedis.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(service.set('policy:1', { id: 1 }, 30)).resolves.toBeUndefined();
    });
  });

  describe('delByPrefix', () => {
    it('calls redis.delPattern with wildcard', async () => {
      mockRedis.delPattern.mockResolvedValueOnce(undefined);
      await service.delByPrefix('policy');
      expect(mockRedis.delPattern).toHaveBeenCalledWith('niffy:test:policy*');
    });

    it('applies tenant prefix', async () => {
      mockRedis.delPattern.mockResolvedValueOnce(undefined);
      await service.delByPrefix('policy', 'acme');
      expect(mockRedis.delPattern).toHaveBeenCalledWith('niffy:test:acme:policy*');
    });
  });

  describe('wrap — cache hit', () => {
    it('returns cached value without calling loader', async () => {
      mockRedis.get.mockResolvedValueOnce({ id: 42 });
      const loader = jest.fn();
      const result = await service.wrap('policy:42', 30, loader);
      expect(result).toEqual({ id: 42 });
      expect(loader).not.toHaveBeenCalled();
    });
  });

  describe('wrap — cache miss, lock acquired', () => {
    it('calls loader, caches result, and returns it', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockRedis.acquireLock.mockResolvedValueOnce(true);
      mockRedis.set.mockResolvedValueOnce(undefined);
      mockRedis.releaseLock.mockResolvedValueOnce(undefined);

      const loader = jest.fn().mockResolvedValueOnce({ id: 99 });
      const result = await service.wrap('policy:99', 30, loader);

      expect(loader).toHaveBeenCalledTimes(1);
      expect(mockRedis.set).toHaveBeenCalledWith('niffy:test:policy:99', { id: 99 }, 30);
      expect(result).toEqual({ id: 99 });
    });
  });

  describe('wrap — Redis down', () => {
    it('falls through to loader without throwing', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const loader = jest.fn().mockResolvedValueOnce({ id: 1 });
      const result = await service.wrap('policy:1', 30, loader);
      expect(result).toEqual({ id: 1 });
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });
});
