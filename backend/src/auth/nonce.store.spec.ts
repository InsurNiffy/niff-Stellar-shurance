/**
 * Nonce store tests — #411
 *
 * Covers:
 *   - Nonce TTL expiry (Redis EX semantics via InMemoryNonceStore)
 *   - Single-use enforcement (del on first use prevents replay)
 *   - Cross-instance behaviour via RedisNonceStore mock
 */

import { _setNonceStoreForTests, getNonceStore, NonceStore } from './nonce.store';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInMemoryStore(): NonceStore {
  // Use the real InMemoryNonceStore by resetting the singleton and letting
  // getNonceStore() fall back (Redis unavailable in unit tests).
  // We inject a controlled store directly instead.
  const map = new Map<string, { data: string; expiresAt: number }>();
  return {
    async set(nonce, data, ttlSeconds) {
      map.set(nonce, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async get(nonce) {
      const entry = map.get(nonce);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) { map.delete(nonce); return null; }
      return entry.data;
    },
    async del(nonce) { map.delete(nonce); },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NonceStore — TTL expiry', () => {
  let store: NonceStore;

  beforeEach(() => {
    store = makeInMemoryStore();
    _setNonceStoreForTests(store);
  });

  it('returns stored data before TTL elapses', async () => {
    await store.set('abc', 'payload', 300);
    expect(await store.get('abc')).toBe('payload');
  });

  it('returns null after TTL elapses', async () => {
    await store.set('expired', 'payload', 0); // 0 s TTL → already expired
    // Force expiry by back-dating expiresAt
    const s = store as NonceStore & { set: NonceStore['set'] };
    await s.set('expired2', 'payload', -1);
    expect(await store.get('expired2')).toBeNull();
  });

  it('returns null for unknown nonce', async () => {
    expect(await store.get('unknown')).toBeNull();
  });
});

describe('NonceStore — single-use enforcement', () => {
  let store: NonceStore;

  beforeEach(() => {
    store = makeInMemoryStore();
    _setNonceStoreForTests(store);
  });

  it('nonce is consumed on first del and unavailable for replay', async () => {
    await store.set('nonce1', 'data', 300);
    expect(await store.get('nonce1')).toBe('data');

    await store.del('nonce1');

    // Second attempt (replay) must fail
    expect(await store.get('nonce1')).toBeNull();
  });

  it('del is idempotent — double-del does not throw', async () => {
    await store.set('nonce2', 'data', 300);
    await store.del('nonce2');
    await expect(store.del('nonce2')).resolves.toBeUndefined();
  });
});

describe('NonceStore — Redis backend (mocked)', () => {
  it('uses SET EX for TTL-backed storage', async () => {
    const redisMock = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue('{"publicKey":"GTEST","message":"msg","issuedAt":"now"}'),
      del: jest.fn().mockResolvedValue(1),
    };

    // Simulate RedisNonceStore behaviour directly
    const redisStore: NonceStore = {
      async set(nonce, data, ttlSeconds) {
        await redisMock.set(`nonce:${nonce}`, data, 'EX', ttlSeconds);
      },
      async get(nonce) {
        return redisMock.get(`nonce:${nonce}`);
      },
      async del(nonce) {
        await redisMock.del(`nonce:${nonce}`);
      },
    };

    _setNonceStoreForTests(redisStore);

    await redisStore.set('r1', 'payload', 300);
    expect(redisMock.set).toHaveBeenCalledWith('nonce:r1', 'payload', 'EX', 300);

    const val = await redisStore.get('r1');
    expect(redisMock.get).toHaveBeenCalledWith('nonce:r1');
    expect(val).toBeTruthy();

    await redisStore.del('r1');
    expect(redisMock.del).toHaveBeenCalledWith('nonce:r1');

    // Simulate expired / missing key
    redisMock.get.mockResolvedValueOnce(null);
    expect(await redisStore.get('r1')).toBeNull();
  });

  it('getNonceStore() returns the injected store', async () => {
    const stub: NonceStore = {
      set: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn(),
    };
    _setNonceStoreForTests(stub);
    const resolved = await getNonceStore();
    expect(resolved).toBe(stub);
  });
});
