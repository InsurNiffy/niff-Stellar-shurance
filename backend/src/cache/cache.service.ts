/**
 * CacheService — typed cache helper with TTLs and stampede protection.
 *
 * Keys are namespaced as `niffy:{env}:{tenant}:{key}` when a tenant context is
 * provided, or `niffy:{env}:{key}` for singleton / non-tenant operations.
 *
 * Failure model
 * ─────────────
 * - `get` / `set` / `delByPrefix`: degrade gracefully on Redis error (null / no-op).
 * - `wrap`: falls through to the loader function on any Redis failure.
 * - Prometheus counters record hits, misses and errors per namespace.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, register } from 'prom-client';
import { RedisService } from './redis.service';

// ── Prometheus counters ───────────────────────────────────────────────────────

const cacheHits = new Counter({
  name: 'niffy_cache_hits_total',
  help: 'Total number of cache hits',
  labelNames: ['namespace'],
  registers: [register],
});

const cacheMisses = new Counter({
  name: 'niffy_cache_misses_total',
  help: 'Total number of cache misses',
  labelNames: ['namespace'],
  registers: [register],
});

const cacheErrors = new Counter({
  name: 'niffy_cache_errors_total',
  help: 'Total number of cache errors (Redis unavailable or serialisation failures)',
  labelNames: ['namespace', 'operation'],
  registers: [register],
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Derive a low-cardinality namespace label from a bare (un-prefixed) cache key. */
function nsOf(key: string): string {
  return key.split(':')[0] ?? 'other';
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly env: string;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.env = this.config.get<string>('NODE_ENV', 'development');
  }

  // ── Key construction ────────────────────────────────────────────────────────

  /**
   * Build the full Redis key, optionally scoped to a tenant.
   *
   * Format: `niffy:{env}:{tenant}:{key}` or `niffy:{env}:{key}`.
   */
  buildKey(key: string, tenant?: string): string {
    const appName = this.config.get<string>('APP_NAME', 'niffy');
    return tenant
      ? `${appName}:${this.env}:${tenant}:${key}`
      : `${appName}:${this.env}:${key}`;
  }

  // ── Core helpers ────────────────────────────────────────────────────────────

  /**
   * Get a typed cached value.  Returns `null` on miss or Redis error.
   */
  async get<T>(key: string, tenant?: string): Promise<T | null> {
    const fullKey = this.buildKey(key, tenant);
    const ns = nsOf(key);
    try {
      const value = await this.redis.get<T>(fullKey);
      if (value === null) {
        cacheMisses.inc({ namespace: ns });
        return null;
      }
      cacheHits.inc({ namespace: ns });
      return value;
    } catch (err) {
      cacheErrors.inc({ namespace: ns, operation: 'get' });
      this.logger.warn(`CacheService.get failed [${fullKey}]: ${err}`);
      return null;
    }
  }

  /**
   * Set a typed cached value with a TTL in seconds.
   * Silently degrades on Redis error.
   */
  async set<T>(key: string, value: T, ttlSeconds: number, tenant?: string): Promise<void> {
    const fullKey = this.buildKey(key, tenant);
    const ns = nsOf(key);
    try {
      await this.redis.set<T>(fullKey, value, ttlSeconds);
    } catch (err) {
      cacheErrors.inc({ namespace: ns, operation: 'set' });
      this.logger.warn(`CacheService.set failed [${fullKey}]: ${err}`);
    }
  }

  /**
   * Delete all keys sharing a given prefix.
   *
   * Constructs the full namespace prefix (`niffy:{env}:{tenant}:{prefix}*` or
   * `niffy:{env}:{prefix}*`) and removes all matching keys.
   *
   * Note: uses KEYS in development; production deployments with large keyspaces
   * should migrate this to SCAN-based iteration.
   */
  async delByPrefix(prefix: string, tenant?: string): Promise<void> {
    const fullPrefix = this.buildKey(prefix, tenant);
    const ns = nsOf(prefix);
    try {
      await this.redis.delPattern(`${fullPrefix}*`);
    } catch (err) {
      cacheErrors.inc({ namespace: ns, operation: 'delByPrefix' });
      this.logger.warn(`CacheService.delByPrefix failed [${fullPrefix}*]: ${err}`);
    }
  }

  /**
   * Execute `loader` with single-flight lock protection.
   *
   * On a cache miss, only one concurrent caller executes `loader` while others
   * wait for the result to appear in cache (stampede protection).  If Redis is
   * unavailable, all callers fall through to an unprotected `loader` execution.
   *
   * @param key      - Cache key (bare, without namespace prefix)
   * @param ttl      - TTL in seconds for the cached result
   * @param loader   - Async function to compute the value on a cache miss
   * @param tenant   - Optional tenant identifier for namespace isolation
   */
  async wrap<T>(
    key: string,
    ttl: number,
    loader: () => Promise<T>,
    tenant?: string,
  ): Promise<T> {
    const fullKey = this.buildKey(key, tenant);
    const ns = nsOf(key);

    // 1. Check cache first.
    try {
      const cached = await this.redis.get<T>(fullKey);
      if (cached !== null) {
        cacheHits.inc({ namespace: ns });
        return cached;
      }
      cacheMisses.inc({ namespace: ns });
    } catch {
      cacheErrors.inc({ namespace: ns, operation: 'wrap_read' });
      // Redis down — skip to unprotected loader.
      return loader();
    }

    // 2. Try to acquire the single-flight lock.
    let lockAcquired = false;
    try {
      lockAcquired = await this.redis.acquireLock(fullKey, 30);
    } catch {
      cacheErrors.inc({ namespace: ns, operation: 'wrap_lock' });
      return loader();
    }

    if (lockAcquired) {
      try {
        const result = await loader();
        try {
          await this.redis.set<T>(fullKey, result, ttl);
        } catch {
          cacheErrors.inc({ namespace: ns, operation: 'wrap_write' });
        }
        return result;
      } finally {
        await this.redis.releaseLock(fullKey).catch(() => undefined);
      }
    }

    // 3. Another caller holds the lock — wait for it, then read from cache.
    try {
      await this.redis.waitForLock(fullKey, 5_000);
      const cached = await this.redis.get<T>(fullKey);
      if (cached !== null) {
        cacheHits.inc({ namespace: ns });
        return cached;
      }
    } catch {
      cacheErrors.inc({ namespace: ns, operation: 'wrap_wait' });
    }

    // 4. Lock released but still a miss (loader may have failed) — execute unprotected.
    return loader();
  }
}
