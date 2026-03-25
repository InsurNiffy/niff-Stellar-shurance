/**
 * Nonce store abstraction with Redis backend and in-memory fallback.
 *
 * Redis is strongly preferred for production because it survives process
 * restarts and works across multiple backend replicas.  The in-memory
 * fallback is acceptable for local dev or single-instance deploys.
 *
 * Each nonce is stored with a TTL; expired entries are rejected and deleted.
 * Nonces are deleted on first successful use (replay resistance).
 */

import Redis from 'ioredis';
import { config } from '../config/env';

export interface NonceStore {
  set(nonce: string, data: string, ttlSeconds: number): Promise<void>;
  get(nonce: string): Promise<string | null>;
  del(nonce: string): Promise<void>;
}

// ── In-memory fallback ────────────────────────────────────────────────────────

class InMemoryNonceStore implements NonceStore {
  private readonly store = new Map<string, { data: string; expiresAt: number }>();

  async set(nonce: string, data: string, ttlSeconds: number): Promise<void> {
    this.store.set(nonce, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
    this.evictExpired();
  }

  async get(nonce: string): Promise<string | null> {
    const entry = this.store.get(nonce);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(nonce);
      return null;
    }
    return entry.data;
  }

  async del(nonce: string): Promise<void> {
    this.store.delete(nonce);
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }
}

// ── Redis backend ─────────────────────────────────────────────────────────────

class RedisNonceStore implements NonceStore {
  constructor(private readonly redis: Redis) {}

  async set(nonce: string, data: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(`nonce:${nonce}`, data, 'EX', ttlSeconds);
  }

  async get(nonce: string): Promise<string | null> {
    return this.redis.get(`nonce:${nonce}`);
  }

  async del(nonce: string): Promise<void> {
    await this.redis.del(`nonce:${nonce}`);
  }
}

// ── Factory (lazy singleton) ──────────────────────────────────────────────────

let _store: NonceStore | null = null;

export async function getNonceStore(): Promise<NonceStore> {
  if (_store) return _store;

  try {
    const redis = new Redis(config.redis.url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 2000,
    });
    await redis.connect();
    _store = new RedisNonceStore(redis);
    console.info('[nonce-store] Using Redis backend');
  } catch {
    console.warn(
      '[nonce-store] Redis unavailable — falling back to in-memory store. ' +
        'This is NOT suitable for multi-replica deployments.',
    );
    _store = new InMemoryNonceStore();
  }

  return _store;
}

/** Exposed for unit tests to inject a custom store. */
export function _setNonceStoreForTests(store: NonceStore): void {
  _store = store;
}
