/**
 * Redis cache helper tests.
 *
 * Run against a real Redis instance:
 *   REDIS_HOST=127.0.0.1 REDIS_PORT=6379 npm test
 *
 * In CI, a Redis service container is started (see ci.yml).
 * Tests are skipped automatically if Redis is unreachable.
 */

import {
  cacheGet,
  cacheSet,
  cacheDel,
  setNonce,
  consumeNonce,
  incrementRateLimit,
  RedisUnavailableError,
} from "../redis";
import { closeRedisClient } from "../redis/client";

const REDIS_AVAILABLE = process.env.REDIS_HOST !== undefined || process.env.CI === "true";

const describeIfRedis = REDIS_AVAILABLE ? describe : describe.skip;

afterAll(async () => {
  await closeRedisClient();
});

describeIfRedis("cache helpers", () => {
  const key = `test:cache:${Date.now()}`;

  afterEach(async () => {
    await cacheDel(key);
  });

  test("cacheSet and cacheGet round-trip", async () => {
    await cacheSet(key, { foo: "bar" }, 60);
    const result = await cacheGet<{ foo: string }>(key);
    expect(result).toEqual({ foo: "bar" });
  });

  test("cacheGet returns null for missing key", async () => {
    const result = await cacheGet("test:nonexistent:key");
    expect(result).toBeNull();
  });

  test("cacheSet respects TTL — key expires", async () => {
    const shortKey = `test:ttl:${Date.now()}`;
    await cacheSet(shortKey, "ephemeral", 1);
    // Wait for expiry
    await new Promise((r) => setTimeout(r, 1_100));
    const result = await cacheGet(shortKey);
    expect(result).toBeNull();
  });

  test("cacheDel removes key", async () => {
    await cacheSet(key, "to-delete", 60);
    await cacheDel(key);
    const result = await cacheGet(key);
    expect(result).toBeNull();
  });
});

describeIfRedis("nonce helpers (fail closed)", () => {
  const address = `0xtest${Date.now()}`;

  test("setNonce and consumeNonce round-trip", async () => {
    const nonce = "abc123";
    await setNonce(address, nonce);
    const consumed = await consumeNonce(address);
    expect(consumed).toBe(nonce);
  });

  test("consumeNonce is single-use (atomic GET+DEL)", async () => {
    await setNonce(address, "once");
    await consumeNonce(address);
    const second = await consumeNonce(address);
    expect(second).toBeNull();
  });

  test("consumeNonce returns null for unknown address", async () => {
    const result = await consumeNonce("0xunknown");
    expect(result).toBeNull();
  });
});

describeIfRedis("rate limit helper (fail open)", () => {
  test("incrementRateLimit increments counter", async () => {
    const id = `test-ip-${Date.now()}`;
    const c1 = await incrementRateLimit(id);
    const c2 = await incrementRateLimit(id);
    expect(c1).toBe(1);
    expect(c2).toBe(2);
    // cacheDel uses the same client (with keyPrefix), so key matches
    await cacheDel(`ratelimit:${id}`);
  });
});

describe("RedisUnavailableError", () => {
  test("is an Error subclass", () => {
    const err = new RedisUnavailableError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("RedisUnavailableError");
  });

  test("wraps cause", () => {
    const cause = new Error("ECONNREFUSED");
    const err = new RedisUnavailableError(cause);
    expect(err.cause).toBe(cause);
  });
});
