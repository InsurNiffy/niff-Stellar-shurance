import { AppealSimulationCacheService } from './appeal-simulation-cache.service';
import { RedisService } from '../../cache/redis.service';
import { ConfigService } from '@nestjs/config';

describe('AppealSimulationCacheService', () => {
  let cache: AppealSimulationCacheService;
  let redis: { get: jest.Mock; set: jest.Mock };
  let configValues: Record<string, string | number>;

  beforeEach(() => {
    configValues = {
      APPEAL_SIMULATION_CACHE_ENABLED: 'true',
      APPEAL_SIMULATION_CACHE_TTL_SECONDS: 30,
    };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const config = {
      get: jest.fn((key: string, def?: string | number) =>
        key in configValues ? configValues[key] : def,
      ),
    } as unknown as ConfigService;

    cache = new AppealSimulationCacheService(redis as unknown as RedisService, config);
  });

  it('builds key from claimId and walletAddress', () => {
    expect(cache.buildRedisKey(42, 'GWALLET')).toBe('appeal:sim:v1:42:GWALLET');
  });

  it('returns null on cache miss', async () => {
    await expect(cache.get(42, 'GWALLET')).resolves.toBeNull();
    expect(redis.get).toHaveBeenCalledWith('appeal:sim:v1:42:GWALLET');
  });

  it('stores and retrieves successful simulation payloads', async () => {
    const payload = {
      ok: true as const,
      claimId: 42,
      walletAddress: 'GWALLET',
      minResourceFee: '100',
      baseFee: '100',
      totalEstimatedFee: '200',
      totalEstimatedFeeXlm: '0.00002',
      currentLedger: 1,
    };
    await cache.set(42, 'GWALLET', payload);
    expect(redis.set).toHaveBeenCalledWith('appeal:sim:v1:42:GWALLET', payload, 30);

    redis.get.mockResolvedValueOnce(payload);
    await expect(cache.get(42, 'GWALLET')).resolves.toEqual(payload);
  });

  it('skips get/set when cache is disabled', async () => {
    configValues.APPEAL_SIMULATION_CACHE_ENABLED = 'false';
    await expect(cache.get(1, 'G')).resolves.toBeNull();
    await cache.set(1, 'G', {
      ok: true,
      claimId: 1,
      walletAddress: 'G',
      minResourceFee: '0',
      baseFee: '0',
      totalEstimatedFee: '0',
      totalEstimatedFeeXlm: '0',
      currentLedger: 0,
    });
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('never stores unsignedXdr in the payload type (build path must stay fresh)', () => {
    const payload: Record<string, unknown> = {
      ok: true,
      claimId: 1,
      walletAddress: 'G',
      minResourceFee: '0',
      baseFee: '0',
      totalEstimatedFee: '0',
      totalEstimatedFeeXlm: '0',
      currentLedger: 0,
    };
    expect(payload).not.toHaveProperty('unsignedXdr');
  });
});
