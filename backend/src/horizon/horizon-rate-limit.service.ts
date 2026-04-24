/**
 * HorizonRateLimitService
 *
 * Sliding-window rate limiter for the Horizon proxy endpoint.
 * Limit: 30 requests per 60 seconds per wallet address (or IP for anonymous).
 *
 * Implementation: Redis sorted set keyed by account address.
 * Each request adds a member with score = current timestamp (ms).
 * Members older than the window are pruned on every check.
 * The count of remaining members is the number of requests in the window.
 *
 * Atomic pipeline (MULTI/EXEC) ensures no race conditions under concurrent
 * requests from the same account.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../cache/redis.service';

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the oldest request in the window expires. */
  retryAfterSeconds: number;
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
const KEY_PREFIX = 'horizon:rl:';

@Injectable()
export class HorizonRateLimitService {
  private readonly logger = new Logger(HorizonRateLimitService.name);
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.maxRequests = this.config.get<number>('HORIZON_RATE_LIMIT_MAX', MAX_REQUESTS);
    this.windowMs = this.config.get<number>('HORIZON_RATE_LIMIT_WINDOW_MS', WINDOW_MS);
  }

  async check(account: string): Promise<RateLimitResult> {
    const key = `${KEY_PREFIX}${account}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const member = `${now}-${Math.random()}`;

    try {
      const client = this.redis.getClient();
      const pipeline = client.multi();

      // Remove expired entries outside the window
      pipeline.zremrangebyscore(key, '-inf', String(windowStart));
      // Count requests in the current window
      pipeline.zcard(key);
      // Add this request
      pipeline.zadd(key, now, member);
      // Reset TTL so the key expires after the window
      pipeline.expire(key, Math.ceil(this.windowMs / 1000));

      const results = await pipeline.exec();

      // zcard result is at index 1
      const count = (results?.[1]?.[1] as number) ?? 0;

      if (count >= this.maxRequests) {
        // Oldest member score = earliest request timestamp in window
        const oldest = await client.zrange(key, 0, 0, 'WITHSCORES');
        const oldestTs = oldest?.[1] ? Number(oldest[1]) : now;
        const retryAfterMs = oldestTs + this.windowMs - now;
        const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

        return { allowed: false, retryAfterSeconds };
      }

      return { allowed: true, retryAfterSeconds: 0 };
    } catch (err) {
      // Fail open — Redis unavailability must not block legitimate requests
      this.logger.warn(`Rate limit check failed for ${account}: ${err}`);
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }
}
