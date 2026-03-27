/**
 * Cache helpers with TTL conventions and graceful degradation.
 *
 * IMPORTANT: Redis is a cache layer only. Postgres is the authoritative store
 * for all financial data. A cache miss always falls through to the database.
 * Never write financial truth exclusively to Redis.
 */

import { getRedisClient, RedisUnavailableError } from "./client";
import { TTL } from "./config";

// ── Generic get/set/del ───────────────────────────────────────────────────────

/**
 * Get a cached value. Returns null on cache miss OR Redis unavailability.
 * Callers should treat null as "fetch from DB".
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedisClient().get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    // Degrade gracefully — cache miss is always safe
    return null;
  }
}

/**
 * Set a cached value with a TTL in seconds.
 * Silently swallows Redis errors — the DB remains authoritative.
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<void> {
  try {
    await getRedisClient().set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // Non-fatal — log in production monitoring
  }
}

/** Delete a cached key (e.g. on mutation). Silently swallows errors. */
export async function cacheDel(key: string): Promise<void> {
  try {
    await getRedisClient().del(key);
  } catch {
    // Non-fatal
  }
}

// ── Domain-specific helpers ───────────────────────────────────────────────────

/** Cache a policy read response. TTL: POLICY_CACHE_SECONDS (30 s). */
export async function cachePolicy<T>(policyKey: string, value: T): Promise<void> {
  await cacheSet(`cache:policy:${policyKey}`, value, TTL.POLICY_CACHE_SECONDS);
}

export async function getCachedPolicy<T>(policyKey: string): Promise<T | null> {
  return cacheGet<T>(`cache:policy:${policyKey}`);
}

export async function invalidatePolicy(policyKey: string): Promise<void> {
  await cacheDel(`cache:policy:${policyKey}`);
}

/** Cache a claim read response. TTL: CLAIM_CACHE_SECONDS (10 s). */
export async function cacheClaim<T>(claimId: string | number, value: T): Promise<void> {
  await cacheSet(`cache:claim:${claimId}`, value, TTL.CLAIM_CACHE_SECONDS);
}

export async function getCachedClaim<T>(claimId: string | number): Promise<T | null> {
  return cacheGet<T>(`cache:claim:${claimId}`);
}

export async function invalidateClaim(claimId: string | number): Promise<void> {
  await cacheDel(`cache:claim:${claimId}`);
}

// ── Wallet-auth nonce (FAIL CLOSED) ──────────────────────────────────────────
//
// Nonces are single-use challenge strings issued during wallet authentication.
// If Redis is unavailable, nonce storage fails and auth is rejected entirely.
// This is intentional: allowing auth without nonce storage would bypass
// replay-attack protection.

/**
 * Store a wallet-auth challenge nonce for `address`.
 * TTL: NONCE_SECONDS (5 min). Throws RedisUnavailableError if Redis is down.
 */
export async function setNonce(address: string, nonce: string): Promise<void> {
  const client = getRedisClient();
  try {
    await client.set(`nonce:${address}`, nonce, "EX", TTL.NONCE_SECONDS);
  } catch (err) {
    // FAIL CLOSED — surface the error so auth is rejected
    throw new RedisUnavailableError(err);
  }
}

/**
 * Consume a nonce: atomically GET + DEL.
 * Returns the nonce string, or null if expired / not found.
 * Throws RedisUnavailableError if Redis is down (fail closed).
 */
export async function consumeNonce(address: string): Promise<string | null> {
  const client = getRedisClient();
  const key = `nonce:${address}`;
  try {
    // Lua script for atomic GET+DEL — prevents TOCTOU race
    const script = `
      local v = redis.call('GET', KEYS[1])
      if v then redis.call('DEL', KEYS[1]) end
      return v
    `;
    const result = await client.eval(script, 1, key) as string | null;
    return result ?? null;
  } catch (err) {
    throw new RedisUnavailableError(err);
  }
}

// ── Rate limiting (FAIL OPEN) ─────────────────────────────────────────────────

/**
 * Increment a rate-limit counter for `identifier` (e.g. IP address).
 * Returns the new count. Returns Infinity if Redis is unavailable (fail open).
 * TTL: RATE_LIMIT_SECONDS (60 s) — set only on first increment.
 */
export async function incrementRateLimit(identifier: string): Promise<number> {
  const client = getRedisClient();
  const key = `ratelimit:${identifier}`;
  try {
    const count = await client.incr(key);
    if (count === 1) {
      // First request in window — set expiry
      await client.expire(key, TTL.RATE_LIMIT_SECONDS);
    }
    return count;
  } catch {
    // FAIL OPEN — log warning; do not block the request
    console.warn("[redis] rate-limit unavailable, failing open for", identifier);
    return 0;
  }
}

// ── Idempotency (FAIL OPEN) ───────────────────────────────────────────────────
//
// Idempotency keys map a hashed (method + path + key + subject) to a cached
// response envelope { status, body, version }.  If Redis is unavailable the
// request is processed normally (fail open) — a duplicate may go through, but
// the service remains available.  This is documented behaviour; clients must
// treat Redis unavailability as a best-effort guarantee.

export interface IdempotencyEntry {
  status: number;
  body: unknown;
  /** Schema version — bump when response shape changes to invalidate old entries. */
  version: number;
}

/**
 * Store an idempotency response.  TTL is always set (bounded Redis growth).
 * Silently swallows Redis errors (fail open).
 */
export async function setIdempotencyEntry(
  key: string,
  entry: IdempotencyEntry,
  ttlSeconds: number,
): Promise<void> {
  await cacheSet(`idempotency:${key}`, entry, ttlSeconds);
}

/**
 * Retrieve a cached idempotency response.
 * Returns null on cache miss, Redis error, or version mismatch.
 */
export async function getIdempotencyEntry(
  key: string,
  currentVersion: number,
): Promise<IdempotencyEntry | null> {
  const entry = await cacheGet<IdempotencyEntry>(`idempotency:${key}`);
  if (!entry || entry.version !== currentVersion) return null;
  return entry;
}
