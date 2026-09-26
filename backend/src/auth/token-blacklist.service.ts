import { Injectable } from '@nestjs/common';
import { RedisService } from '../cache/redis.service';

const TOKEN_BLACKLIST_PREFIX = 'token:blacklist:';

@Injectable()
export class TokenBlacklistService {
  constructor(private readonly redis: RedisService) {}

  /**
   * Blacklist a JWT by its jti (ID) until the token would have expired.
   * @param jti JWT ID claim
   * @param ttlSeconds Time to live in seconds (calculated as token.exp - now)
   */
  async blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) {
      return; // Token already expired, no need to blacklist
    }

    const key = TOKEN_BLACKLIST_PREFIX + jti;
    await this.redis.getClient().setex(key, ttlSeconds, '1');
  }

  /**
   * Check if a JWT jti is blacklisted.
   * @param jti JWT ID claim
   */
  async isBlacklisted(jti: string): Promise<boolean> {
    const key = TOKEN_BLACKLIST_PREFIX + jti;
    const result = await this.redis.getClient().exists(key);
    return result === 1;
  }

  /**
   * Revoke a token immediately by adding to blacklist.
   * @param jti JWT ID claim
   * @param expiresAt Unix timestamp when token expires
   */
  async revokeToken(jti: string, expiresAt: number): Promise<void> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttlSeconds = Math.max(0, expiresAt - nowSeconds);
    await this.blacklistToken(jti, ttlSeconds);
  }
}
