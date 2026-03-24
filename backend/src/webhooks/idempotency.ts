/**
 * Idempotency / deduplication store.
 *
 * Strategy
 * ────────
 * Keys are stored with a TTL equal to 2× the provider's timestamp tolerance
 * (default 10 minutes). This ensures:
 *   - Any duplicate delivery within the replay window is deduplicated.
 *   - Memory usage is bounded — entries expire automatically.
 *
 * Key format: "<provider>:<idempotencyKey>"
 *
 * In production, replace the in-memory Map with a Redis SET NX + EXPIRE
 * call for distributed deduplication across multiple instances.
 *
 * Documented idempotency keys per provider:
 *   github  — X-GitHub-Delivery header (UUID, unique per delivery attempt)
 *   stripe  — payload.id (evt_... event ID, unique per event)
 *   generic — X-Webhook-Id header
 */

interface Entry {
  expiresAt: number;
}

const store = new Map<string, Entry>();

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

function evict(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}

/**
 * Returns true if this key has been seen before (duplicate).
 * Registers the key if it hasn't been seen.
 */
export function isDuplicate(
  provider: string,
  idempotencyKey: string,
  ttlMs = DEFAULT_TTL_MS
): boolean {
  evict();
  const key = `${provider}:${idempotencyKey}`;
  if (store.has(key)) return true;
  store.set(key, { expiresAt: Date.now() + ttlMs });
  return false;
}

/** Reset — used in tests only. */
export function _resetIdempotencyStore(): void {
  store.clear();
}
