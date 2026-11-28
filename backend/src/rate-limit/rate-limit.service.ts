import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitOptions {
  /** Logical bucket name, e.g. "claims:build-transaction". */
  scope: string;
  /** Identifier the limit applies to, e.g. a wallet address. */
  identifier: string;
  /** Max number of requests allowed within the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * Redis-backed sliding window rate limiter.
 *
 * Uses a sorted set per (scope, identifier) where each member is a unique
 * request id scored by its millisecond timestamp. Expired entries are pruned
 * on every check and the key TTL is aligned with the window so Redis storage
 * is reclaimed automatically.
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly redis: Redis;

  constructor(private readonly configService: ConfigService) {
    const url =
      this.configService.get<string>("REDIS_URL") ??
      "redis://localhost:6379";
    this.redis = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });
    this.redis.on("error", (err) =>
      this.logger.error(`Redis rate-limit error: ${err.message}`),
    );
  }

  private buildKey(scope: string, identifier: string): string {
    return `ratelimit:${scope}:${identifier.toLowerCase()}`;
  }

  /**
   * Records a request and reports whether it is within the configured limit.
   * Fails open (allows the request) if Redis is unavailable so that a cache
   * outage does not take down governance endpoints.
   */
  async consume(options: RateLimitOptions): Promise<RateLimitResult> {
    const { scope, identifier, limit, windowSeconds } = options;
    const key = this.buildKey(scope, identifier);
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = now - windowMs;
    const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;

    try {
      const pipeline = this.redis.multi();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zadd(key, now, member);
      pipeline.zcard(key);
      pipeline.pexpire(key, windowMs);
      const results = await pipeline.exec();

      const count = Number(results?.[2]?.[1] ?? 0);

      if (count > limit) {
        // Remove the just-added member so rejected requests do not extend
        // the window for legitimate callers.
        await this.redis.zrem(key, member);

        const oldest = await this.redis.zrange(key, 0, 0, "WITHSCORES");
        const oldestScore = oldest.length > 1 ? Number(oldest[1]) : now;
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((oldestScore + windowMs - now) / 1000),
        );

        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds,
          limit,
          windowSeconds,
        };
      }

      return {
        allowed: true,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds: 0,
        limit,
        windowSeconds,
      };
    } catch (err) {
      this.logger.warn(
        `Rate limit check failed for ${scope}:${identifier} — allowing request: ${
          (err as Error).message
        }`,
      );
      return {
        allowed: true,
        remaining: limit,
        retryAfterSeconds: 0,
        limit,
        windowSeconds,
      };
    }
  }

  /** Clears the counter for a scope/identifier pair (e.g. after a successful claim). */
  async reset(scope: string, identifier: string): Promise<void> {
    try {
      await this.redis.del(this.buildKey(scope, identifier));
    } catch (err) {
      this.logger.warn(
        `Failed to reset rate limit for ${scope}:${identifier}: ${
          (err as Error).message
        }`,
      );
    }
  }
}
