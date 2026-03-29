import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { RedisService } from '../../cache/redis.service';

/**
 * Redis-backed storage for @nestjs/throttler.
 *
 * Keys: throttle:<throttlerName>:<tracker>
 * Each key is a sorted set of request timestamps (ms).
 * TTL is set to the window size so Redis auto-expires stale keys.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const client = this.redis.getClient();
    const redisKey = `throttle:${throttlerName}:${key}`;
    const now = Date.now();
    const windowStart = now - ttl;
    const ttlSec = Math.ceil(ttl / 1000);

    // Sliding window: remove timestamps outside the current window, add now
    const pipeline = client.pipeline();
    pipeline.zremrangebyscore(redisKey, '-inf', windowStart);
    pipeline.zadd(redisKey, now, `${now}-${Math.random()}`);
    pipeline.zcard(redisKey);
    pipeline.expire(redisKey, ttlSec);
    const results = await pipeline.exec();

    // zcard result is at index 2
    const totalHits = (results?.[2]?.[1] as number) ?? 1;
    const isBlocked = totalHits > limit;

    let timeToExpire = ttl;
    if (isBlocked && blockDuration > 0) {
      timeToExpire = blockDuration;
    }

    return {
      totalHits,
      timeToExpire,
      isBlocked,
      timeToBlockExpire: isBlocked ? blockDuration : 0,
    };
  }
}
