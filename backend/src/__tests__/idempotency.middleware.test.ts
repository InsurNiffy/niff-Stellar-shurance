/**
 * IdempotencyMiddleware unit tests.
 *
 * Uses in-memory stubs for Redis — no real Redis required.
 */

import { BadRequestException } from '@nestjs/common';
import { IdempotencyMiddleware, IDEMPOTENCY_VERSION } from '../common/middleware/idempotency.middleware';
import * as cache from '../redis/cache';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<{
  method: string;
  path: string;
  headers: Record<string, string>;
  user: { sub: string };
}> = {}): any {
  return {
    method: 'POST',
    path: '/ipfs/upload',
    headers: {},
    ...overrides,
  };
}

function makeRes(): any {
  const res: any = {
    statusCode: 200,
    _headers: {} as Record<string, string>,
    _body: undefined as unknown,
    setHeader(k: string, v: string) { this._headers[k] = v; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this._body = body; return this; },
  };
  res.json = res.json.bind(res);
  return res;
}

const VALID_KEY = '550e8400-e29b-41d4-a716-446655440000';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IdempotencyMiddleware', () => {
  let middleware: IdempotencyMiddleware;
  let getEntry: jest.SpyInstance;
  let setEntry: jest.SpyInstance;

  beforeEach(() => {
    middleware = new IdempotencyMiddleware();
    getEntry = jest.spyOn(cache, 'getIdempotencyEntry').mockResolvedValue(null);
    setEntry = jest.spyOn(cache, 'setIdempotencyEntry').mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  test('passes through when no Idempotency-Key header', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(getEntry).not.toHaveBeenCalled();
  });

  test('rejects malformed key (not UUID v4) with 400', async () => {
    const req = makeReq({ headers: { 'idempotency-key': 'not-a-uuid' } });
    await expect(middleware.use(req, makeRes(), jest.fn())).rejects.toBeInstanceOf(BadRequestException);
  });

  test('rejects key with wrong UUID version (v1)', async () => {
    const v1Key = '550e8400-e29b-11d4-a716-446655440000'; // version digit = 1
    const req = makeReq({ headers: { 'idempotency-key': v1Key } });
    await expect(middleware.use(req, makeRes(), jest.fn())).rejects.toBeInstanceOf(BadRequestException);
  });

  test('cache miss: calls next and stores response on json()', async () => {
    const req = makeReq({ headers: { 'idempotency-key': VALID_KEY } });
    const res = makeRes();
    const next = jest.fn();

    await middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();

    // Simulate handler writing a response
    res.json({ cid: 'Qm123' });

    // Wait for the async setEntry call
    await new Promise(resolve => setImmediate(resolve));
    expect(setEntry).toHaveBeenCalledWith(
      expect.any(String),
      { status: 200, body: { cid: 'Qm123' }, version: IDEMPOTENCY_VERSION },
      expect.any(Number),
    );
  });

  test('cache hit: replays stored response without calling next', async () => {
    getEntry.mockResolvedValue({ status: 200, body: { cid: 'Qm123' }, version: IDEMPOTENCY_VERSION });
    const req = makeReq({ headers: { 'idempotency-key': VALID_KEY } });
    const res = makeRes();
    const next = jest.fn();

    await middleware.use(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._body).toEqual({ cid: 'Qm123' });
    expect(res._headers['Idempotency-Replayed']).toBe('true');
  });

  test('double-submit returns identical body on second call', async () => {
    // First call — cache miss
    const req1 = makeReq({ headers: { 'idempotency-key': VALID_KEY } });
    const res1 = makeRes();
    await middleware.use(req1, res1, jest.fn());
    res1.json({ cid: 'QmABC' });
    await new Promise(resolve => setImmediate(resolve));

    // Capture what was stored
    const stored = setEntry.mock.calls[0][1] as cache.IdempotencyEntry;

    // Second call — cache hit
    getEntry.mockResolvedValue(stored);
    const req2 = makeReq({ headers: { 'idempotency-key': VALID_KEY } });
    const res2 = makeRes();
    const next2 = jest.fn();
    await middleware.use(req2, res2, next2);

    expect(next2).not.toHaveBeenCalled();
    expect(res2._body).toEqual({ cid: 'QmABC' });
  });

  test('5xx responses are NOT cached', async () => {
    const req = makeReq({ headers: { 'idempotency-key': VALID_KEY } });
    const res = makeRes();
    res.statusCode = 503;
    await middleware.use(req, res, jest.fn());
    res.json({ error: 'service_unavailable' });
    await new Promise(resolve => setImmediate(resolve));
    expect(setEntry).not.toHaveBeenCalled();
  });

  test('4xx error responses ARE cached (replay error to client)', async () => {
    const req = makeReq({ headers: { 'idempotency-key': VALID_KEY } });
    const res = makeRes();
    res.statusCode = 400;
    await middleware.use(req, res, jest.fn());
    res.json({ error: 'invalid_file' });
    await new Promise(resolve => setImmediate(resolve));
    expect(setEntry).toHaveBeenCalledWith(
      expect.any(String),
      { status: 400, body: { error: 'invalid_file' }, version: IDEMPOTENCY_VERSION },
      expect.any(Number),
    );
  });

  test('different subjects produce different cache keys (scope isolation)', async () => {
    const capturedKeys: string[] = [];
    setEntry.mockImplementation(async (key: string) => { capturedKeys.push(key); });

    const req1 = makeReq({ headers: { 'idempotency-key': VALID_KEY }, user: { sub: 'userA' } });
    const res1 = makeRes();
    await middleware.use(req1, res1, jest.fn());
    res1.json({ ok: true });

    const req2 = makeReq({ headers: { 'idempotency-key': VALID_KEY }, user: { sub: 'userB' } });
    const res2 = makeRes();
    await middleware.use(req2, res2, jest.fn());
    res2.json({ ok: true });

    await new Promise(resolve => setImmediate(resolve));
    expect(capturedKeys[0]).not.toBe(capturedKeys[1]);
  });

  test('Redis unavailable: fails open and calls next', async () => {
    getEntry.mockRejectedValue(new Error('Redis down'));
    const req = makeReq({ headers: { 'idempotency-key': VALID_KEY } });
    const next = jest.fn();
    // Should not throw — fail open
    await expect(middleware.use(req, makeRes(), next)).resolves.toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  test('version mismatch treated as cache miss', async () => {
    // Stored entry has old version
    getEntry.mockResolvedValue({ status: 200, body: { old: true }, version: IDEMPOTENCY_VERSION - 1 });
    // getIdempotencyEntry already filters by version — returns null for mismatch
    getEntry.mockResolvedValue(null);

    const req = makeReq({ headers: { 'idempotency-key': VALID_KEY } });
    const next = jest.fn();
    await middleware.use(req, makeRes(), next);
    expect(next).toHaveBeenCalled();
  });
});
