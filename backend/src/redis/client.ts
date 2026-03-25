/**
 * Singleton ioredis client with connection pooling and health-check support.
 *
 * Outage behaviour
 * ────────────────
 * Redis is NOT required for the application to start. The client is created
 * lazily on first use. If Redis is unavailable:
 *
 *   - Wallet-auth nonce operations  → FAIL CLOSED (throw RedisUnavailableError)
 *     Rationale: a nonce that cannot be stored cannot be verified; allowing
 *     auth to proceed would bypass replay protection entirely.
 *
 *   - Rate limiting                 → FAIL OPEN (log warning, allow request)
 *     Rationale: degraded rate limiting is preferable to a full outage.
 *     Operators should alert on Redis unavailability and restore quickly.
 *
 *   - Response caches               → DEGRADE GRACEFULLY (cache miss, hit DB)
 *     Rationale: Postgres is authoritative; a cache miss is always safe.
 *
 *   - BullMQ job queues             → FAIL CLOSED (job not enqueued, return error)
 *     Rationale: jobs represent async work (e.g. claim event indexing); losing
 *     them silently would create data gaps. Callers must handle the error.
 *
 * These behaviours are enforced by the helpers in cache.ts and the queue
 * workers in queues/. This file only manages the connection lifecycle.
 */

import Redis from "ioredis";
import { buildRedisConfig } from "./config";

export class RedisUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Redis is unavailable");
    this.name = "RedisUnavailableError";
    if (cause instanceof Error) this.cause = cause;
  }
}

let _client: Redis | null = null;

/**
 * Returns the shared ioredis client, creating it on first call.
 * The client uses `lazyConnect: true` so the TCP connection is not opened
 * until the first command is issued.
 */
export function getRedisClient(): Redis {
  if (_client) return _client;

  const cfg = buildRedisConfig();

  _client = new Redis({
    host: cfg.host,
    port: cfg.port,
    password: cfg.password,
    tls: cfg.tls ? {} : undefined,
    db: cfg.db,
    keyPrefix: cfg.keyPrefix,
    maxRetriesPerRequest: cfg.maxRetriesPerRequest,
    // Reconnect with exponential backoff, capped at 10 s
    retryStrategy: (times: number) => Math.min(times * 200, 10_000),
    lazyConnect: true,
    enableOfflineQueue: false, // surface errors immediately rather than queuing
  });

  _client.on("error", (err: Error) => {
    // Log but do not crash — individual callers decide fail-open vs fail-closed
    console.error("[redis] connection error:", err.message);
  });

  _client.on("connect", () => {
    console.info("[redis] connected");
  });

  _client.on("reconnecting", () => {
    console.warn("[redis] reconnecting…");
  });

  return _client;
}

/**
 * Returns a *separate* ioredis instance suitable for BullMQ.
 * BullMQ requires its own connection because it uses blocking commands
 * (BRPOP / BLPOP) that cannot share a connection used for regular commands.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ.
 */
export function getBullMQConnection(): Redis {
  const cfg = buildRedisConfig();
  return new Redis({
    host: cfg.host,
    port: cfg.port,
    password: cfg.password,
    tls: cfg.tls ? {} : undefined,
    db: cfg.db,
    keyPrefix: cfg.keyPrefix,
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => Math.min(times * 200, 10_000),
    enableOfflineQueue: false,
  });
}

/**
 * Checks Redis connectivity. Returns true if a PING succeeds within 2 s.
 * Used by the /health endpoint.
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = getRedisClient();
    // Ensure the connection is open before issuing PING
    if (client.status === "wait" || client.status === "close") {
      await client.connect();
    }
    const result = await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 2_000)
      ),
    ]);
    return result === "PONG";
  } catch {
    return false;
  }
}

/** Gracefully closes the shared client. Call on process shutdown. */
export async function closeRedisClient(): Promise<void> {
  if (_client) {
    await _client.quit();
    _client = null;
  }
}
