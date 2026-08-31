/**
 * Redis connection configuration.
 *
 * Key naming conventions
 * ──────────────────────
 * All keys are prefixed with `{service}:{environment}:` to prevent collisions between
 * services and environments:
 *
 *   niffy:production:queue:claim-events   ← BullMQ job queue
 *   niffy:staging:cache:policy:{id}       ← response cache
 *   niffy:development:nonce:{address}     ← wallet-auth challenge nonce
 *   niffy:development:ratelimit:{ip}      ← rate-limit counter
 *
 * Namespace segments:
 *   {service}  = APP_NAME (e.g. "niffy"; overridable by REDIS_KEY_PREFIX_OVERRIDE)
 *   {env}      = NODE_ENV value (development | staging | production)
 *   {area}     = queue | cache | nonce | ratelimit
 *   {id}       = resource-specific identifier
 *
 * TTL conventions (documented here as single source of truth)
 * ────────────────────────────────────────────────────────────
 *   Nonces (wallet-auth challenges) : 5 minutes  — fail-closed on expiry
 *   Rate-limit windows              : 60 seconds — sliding window
 *   Policy response cache           : 30 seconds — stale-while-revalidate acceptable
 *   Claim response cache            : 10 seconds — lower TTL; claim status changes
 *
 * Production security requirements
 * ──────────────────────────────────
 *   - Set REDIS_PASSWORD (min 32 chars, random).
 *   - Set REDIS_TLS=true and provide REDIS_TLS_CA_CERT path for managed Redis.
 *   - Never store sole copies of financial truth in Redis — Postgres is authoritative.
 *   - Redis is an operational cache/queue layer only.
 */

/** Default service name for Redis key prefixing. */
const DEFAULT_APP_NAME = "niffy";

/** Build the Redis key prefix from APP_NAME and NODE_ENV. */
export function buildKeyPrefix(): string {
  const appName = process.env.REDIS_KEY_PREFIX_OVERRIDE ?? process.env.APP_NAME ?? DEFAULT_APP_NAME;
  const env = process.env.NODE_ENV ?? "development";
  return `${appName}:${env}:`;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  tls: boolean;
  /** Logical DB index (0–15). Use 0 for all envs; separate by namespace prefix. */
  db: number;
  /** Key namespace prefix: "{service}:{environment}" */
  keyPrefix: string;
  /** Max connections in the ioredis pool (applies to BullMQ workers too). */
  maxRetriesPerRequest: number | null;
}

export function buildRedisConfig(): RedisConfig {
  const host = process.env.REDIS_HOST ?? "127.0.0.1";
  const port = parseInt(process.env.REDIS_PORT ?? "6379", 10);
  const password = process.env.REDIS_PASSWORD || undefined;
  const tls = process.env.REDIS_TLS === "true";
  const keyPrefix = buildKeyPrefix();

  return {
    host,
    port,
    password,
    tls,
    db: 0,
    keyPrefix,
    // BullMQ requires null to allow blocking commands (BRPOP etc.)
    maxRetriesPerRequest: null,
  };
}

/** TTL constants in seconds — single source of truth for all cache helpers. */
export const TTL = {
  /** Wallet-auth challenge nonce. Fail-closed: expired nonce = auth rejected. */
  NONCE_SECONDS: 5 * 60,
  /** Rate-limit sliding window. */
  RATE_LIMIT_SECONDS: 60,
  /** Policy read cache. Stale-while-revalidate acceptable. */
  POLICY_CACHE_SECONDS: 30,
  /** Claim read cache. Lower TTL because claim status changes frequently. */
  CLAIM_CACHE_SECONDS: 10,
  /**
   * Idempotency key TTL: 24 hours.
   *
   * A client may safely retry any idempotent POST within this window and
   * receive the exact same status code + body as the original response.
   * After expiry the key is evicted and a fresh request is processed normally.
   *
   * Eviction note: TTL is always set unconditionally — Redis growth is bounded.
   * Schema versioning: if a response schema changes, bump IDEMPOTENCY_VERSION
   * in idempotency.middleware.ts; old cached entries will be ignored.
   */
  IDEMPOTENCY_SECONDS: 24 * 60 * 60,
} as const;
