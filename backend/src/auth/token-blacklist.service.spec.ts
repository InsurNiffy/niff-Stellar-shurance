import { TokenBlacklistService } from './token-blacklist.service';
import { RedisService } from '../cache/redis.service';

describe('TokenBlacklistService', () => {
  let service: TokenBlacklistService;
  let redisService: Partial<RedisService>;
  let mockRedisClient: Record<string, jest.Mock>;

  beforeEach(() => {
    mockRedisClient = {
      setex: jest.fn().mockResolvedValue('OK'),
      exists: jest.fn().mockResolvedValue(0),
    };
    redisService = {
      getClient: jest.fn().mockReturnValue(mockRedisClient),
    };
    service = new TokenBlacklistService(redisService as RedisService);
  });

  it('blacklistToken sets key with TTL in Redis', async () => {
    await service.blacklistToken('test-jti', 3600);

    expect(mockRedisClient.setex).toHaveBeenCalledWith('token:blacklist:test-jti', 3600, '1');
  });

  it('blacklistToken ignores tokens with 0 or negative TTL', async () => {
    await service.blacklistToken('expired-jti', 0);
    await service.blacklistToken('very-expired-jti', -100);

    expect(mockRedisClient.setex).not.toHaveBeenCalled();
  });

  it('isBlacklisted returns true when token exists in Redis', async () => {
    mockRedisClient.exists.mockResolvedValueOnce(1);

    const result = await service.isBlacklisted('blacklisted-jti');

    expect(result).toBe(true);
    expect(mockRedisClient.exists).toHaveBeenCalledWith('token:blacklist:blacklisted-jti');
  });

  it('isBlacklisted returns false when token not in Redis', async () => {
    mockRedisClient.exists.mockResolvedValueOnce(0);

    const result = await service.isBlacklisted('not-blacklisted-jti');

    expect(result).toBe(false);
  });

  it('revokeToken calculates TTL from expiry timestamp', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAt = nowSeconds + 7200; // expires in 2 hours
    const expectedTtl = 7200;

    await service.revokeToken('jti-to-revoke', expiresAt);

    const calls = mockRedisClient.setex.mock.calls[0];
    expect(calls[0]).toBe('token:blacklist:jti-to-revoke');
    expect(calls[1]).toBe(expectedTtl);
    expect(calls[2]).toBe('1');
  });

  it('revokeToken uses 0 TTL for already-expired tokens', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAt = nowSeconds - 100; // expired 100 seconds ago

    await service.revokeToken('already-expired-jti', expiresAt);

    expect(mockRedisClient.setex).not.toHaveBeenCalled();
  });

  it('blacklistToken uses correct key prefix', async () => {
    await service.blacklistToken('my-jti', 100);

    const key = mockRedisClient.setex.mock.calls[0][0];
    expect(key).toMatch(/^token:blacklist:/);
    expect(key).toContain('my-jti');
  });
});
