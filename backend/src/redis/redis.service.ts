import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Counter, register } from 'prom-client';
import Redis, { RedisOptions } from 'ioredis';

export interface RedisModuleOptions extends RedisOptions {
  url?: string;
}

const cacheHits = new Counter({
  name: 'redis_cache_hits_total',
  help: 'Total number of Redis cache hits',
  labelNames: ['key_prefix'] as const,
});

const cacheMisses = new Counter({
  name: 'redis_cache_misses_total',
  help: 'Total number of Redis cache misses',
  labelNames: ['key_prefix'] as const,
});

// Register once; ignore duplicate registration errors on hot reload.
try {
  register.registerMetric(cacheHits);
  register.registerMetric(cacheMisses);
} catch {
  // already registered
}

function keyPrefix(key: string): string {
  const idx = key.indexOf(':');
  return idx > 0 ? key.slice(0, idx) : 'default';
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private readonly subscriber: Redis;

  constructor(options: RedisModuleOptions = {}) {
    const { url, ...redisOptions } = options;
    const baseOptions: RedisOptions = {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 200, 5000);
        this.logger.warn(
          `Redis connection retry #${times} in ${delay}ms`,
        );
        return delay;
      },
      reconnectOnError: (err: Error) => {
        this.logger.error(`Redis reconnect on error: ${err.message}`);
        return true;
      },
      ...redisOptions,
    };

    this.client = url ? new Redis(url, baseOptions) : new Redis(baseOptions);
    this.subscriber = this.client.duplicate();

    this.client.on('connect', () =>
      this.logger.log('Redis client connected'),
    );
    this.client.on('ready', () => this.logger.log('Redis client ready'));
    this.client.on('error', (err: Error) =>
      this.logger.error(`Redis client error: ${err.message}`),
    );
    this.client.on('close', () =>
      this.logger.warn('Redis client connection closed'),
    );
    this.client.on('end', () =>
      this.logger.warn('Redis client connection ended'),
    );
  }

  onModuleInit(): void {
    // Connection is established lazily by ioredis; log clearly on failure.
    this.client.connect().catch((err: Error) => {
      this.logger.error(
        `Redis initial connection failed, will retry with backoff: ${err.message}`,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.client.quit(),
      this.subscriber.quit(),
    ]);
  }

  getClient(): Redis {
    return this.client;
  }

  async get<T = string>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) {
      cacheMisses.inc({ key_prefix: keyPrefix(key) });
      return null;
    }
    cacheHits.inc({ key_prefix: keyPrefix(key) });
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  async set<T = unknown>(
    key: string,
    value: T,
    ttlSeconds?: number,
  ): Promise<void> {
    const payload =
      typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, payload, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, payload);
    }
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    return this.client.del(...keys);
  }

  async publish(channel: string, message: unknown): Promise<number> {
    const payload =
      typeof message === 'string' ? message : JSON.stringify(message);
    return this.client.publish(channel, payload);
  }

  async subscribe(
    channel: string,
    handler: (message: string) => void,
  ): Promise<void> {
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (received: string, message: string) => {
      if (received === channel) {
        handler(message);
      }
    });
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.subscriber.unsubscribe(channel);
  }
}
