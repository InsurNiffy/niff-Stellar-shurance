import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { buildRedisConfig } from '../redis/config';


@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly configService: ConfigService) {
    const cfg = buildRedisConfig();
    this.client = new Redis({
      host: cfg.host,
      port: cfg.port,
      password: cfg.password,
      tls: cfg.tls ? {} : undefined,
      db: cfg.db,
      keyPrefix: cfg.keyPrefix,
      lazyConnect: true,
      retryStrategy: (times) => {
        if (times > 3) {
          this.logger.warn('Redis connection failed, operating without cache');
          return null;
        }
        return Math.min(times * 100, 3000);
      },
    });

    this.client.on('error', (err) => {
      this.logger.warn(`Redis error: ${err.message}`);
    });

    this.client.on('connect', () => {
      this.logger.log('Redis connected');
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  getClient(): Redis {
    return this.client;
  }

  /**
   * Get cached value
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      if (value) {
        return JSON.parse(value) as T;
      }
      return null;
    } catch (error) {
      this.logger.warn(`Cache get failed for ${key}: ${error}`);
      return null;
    }
  }

  /**
   * Set cached value with TTL
   */
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.client.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      this.logger.warn(`Cache set failed for ${key}: ${error}`);
    }
  }

  /**
   * Delete cached key
   */
  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.warn(`Cache delete failed for ${key}: ${error}`);
    }
  }

  /**
   * Delete keys matching pattern (use with caution in production)
   */
  async delPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch (error) {
      this.logger.warn(`Cache delete pattern failed for ${pattern}: ${error}`);
    }
  }

  /**
   * Check if Redis is healthy
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Acquire a single-flight lock for cache-miss recomputation.
   * Sets lock key with TTL to prevent indefinite locks on crash.
   * Returns true if lock was acquired, false if already held.
   */
  async acquireLock(key: string, ttlSeconds: number = 30): Promise<boolean> {
    try {
      const lockKey = `lock:${key}`;
      const result = await this.client.set(
        lockKey,
        '1',
        'EX',
        ttlSeconds,
        'NX',
      );
      return result === 'OK';
    } catch (error) {
      this.logger.warn(`Lock acquisition failed for ${key}: ${error}`);
      return false;
    }
  }

  /**
   * Release a single-flight lock.
   */
  async releaseLock(key: string): Promise<void> {
    try {
      await this.client.del(`lock:${key}`);
    } catch (error) {
      this.logger.warn(`Lock release failed for ${key}: ${error}`);
    }
  }

  /**
   * Wait for a lock to be released, polling with backoff.
   * Returns true if lock was released, false on timeout.
   */
  async waitForLock(
    key: string,
    maxWaitMs: number = 5000,
    pollIntervalMs: number = 50,
  ): Promise<boolean> {
    const startTime = Date.now();
    const lockKey = `lock:${key}`;

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const exists = await this.client.exists(lockKey);
        if (exists === 0) {
          return true;
        }
      } catch (error) {
        this.logger.warn(`Lock wait check failed for ${key}: ${error}`);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return false;
  }
}
