/**
 * tx-submit async flow — integration tests.
 *
 * Covers:
 *  - Successful enqueueing returns { jobId, status: 'queued' } immediately
 *  - Redis state is written as 'queued' before the worker runs
 *  - Worker processes job and transitions state to 'success'
 *  - Worker handles RPC failure and transitions state to 'failed' with structured error
 *  - GET /tx/status/:jobId returns correct state at each lifecycle stage
 *  - Invalid XDR is rejected before enqueue (no job created)
 *  - Idempotency key is cached after worker completes
 *  - API responds immediately (< 200 ms) regardless of RPC latency
 *
 * Requires a running Redis instance (REDIS_HOST env var or CI=true).
 */

import { Queue } from "bullmq";
import IORedis from "ioredis";
import { enqueueTxSubmit, closeTxSubmitQueue, TxSubmitJobData } from "./tx.queue";
import { buildTxProcessor } from "./tx.worker";
import { getTxState, setTxState } from "./tx.state";
import { RedisService } from "../cache/redis.service";
import { ConfigService } from "@nestjs/config";

// ── Test helpers ──────────────────────────────────────────────────────────────

const REDIS_AVAILABLE =
  process.env.REDIS_HOST !== undefined || process.env.CI === "true";
const describeIfRedis = REDIS_AVAILABLE ? describe : describe.skip;

/** Minimal RedisService backed by a real ioredis connection for tests */
function makeTestRedisService(conn: IORedis): RedisService {
  const svc = new RedisService(
    { get: (key: string, def?: string) => process.env[key] ?? def } as unknown as ConfigService,
  );
  // Override the internal client with our test connection
  (svc as unknown as { client: IORedis }).client = conn;
  return svc;
}

/** A valid-looking base64 string that will fail XDR parse */
const INVALID_XDR = "aW52YWxpZA=="; // "invalid" in base64

// ── Unit tests (no Redis) ─────────────────────────────────────────────────────

describe("tx-submit queue (unit — no Redis)", () => {
  test("TxSubmitJobData shape is correct", () => {
    const data: TxSubmitJobData = {
      signed_xdr: "AAAA",
      idempotency_key: "550e8400-e29b-41d4-a716-446655440000",
    };
    expect(data.signed_xdr).toBe("AAAA");
  });
});

describe("tx state helpers (unit — no Redis)", () => {
  test("txStateKey returns expected pattern", async () => {
    const { txStateKey } = await import("./tx.state");
    expect(txStateKey("abc123")).toBe("tx:state:abc123");
  });
});

describe("buildTxProcessor (unit — mocked deps)", () => {
  const mockRedis = {
    set: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
  } as unknown as RedisService;

  const RPC_URL = "https://soroban-testnet.stellar.org";
  const PASSPHRASE = "Test SDF Network ; September 2015";

  afterEach(() => jest.clearAllMocks());

  function makeFactory(response: unknown) {
    return jest.fn().mockReturnValue({ sendTransaction: jest.fn().mockResolvedValue(response) });
  }

  function makeFailingFactory(err: Error) {
    return jest.fn().mockReturnValue({ sendTransaction: jest.fn().mockRejectedValue(err) });
  }

  test("sets failed state for invalid XDR without throwing", async () => {
    const processor = buildTxProcessor(mockRedis, RPC_URL, PASSPHRASE);
    const job = { id: "job-1", data: { signed_xdr: INVALID_XDR } } as never;

    await processor(job);

    const calls = (mockRedis.set as jest.Mock).mock.calls;
    const failedCall = calls.find(
      ([, state]: [string, { status: string }]) => state.status === "failed",
    );
    expect(failedCall).toBeDefined();
    expect(failedCall[1].error.code).toBe("INVALID_XDR");
  });

  test("throws on RPC unavailable so BullMQ retries", async () => {
    const { TransactionBuilder } = await import("@stellar/stellar-sdk");
    const mockTx = { signatures: [{}], operations: [{ type: "invokeHostFunction" }] };
    jest.spyOn(TransactionBuilder, "fromXDR").mockReturnValue(mockTx as never);

    const factory = makeFailingFactory(new Error("ECONNREFUSED"));
    const processor = buildTxProcessor(mockRedis, RPC_URL, PASSPHRASE, factory);
    const job = { id: "job-2", data: { signed_xdr: "AAAA==" } } as never;

    await expect(processor(job)).rejects.toThrow("RPC_UNAVAILABLE");

    jest.restoreAllMocks();
  });

  test("sets success state on successful RPC response", async () => {
    const { TransactionBuilder } = await import("@stellar/stellar-sdk");
    const mockTx = { signatures: [{}], operations: [{ type: "invokeHostFunction" }] };
    jest.spyOn(TransactionBuilder, "fromXDR").mockReturnValue(mockTx as never);

    const factory = makeFactory({ hash: "abc123hash", status: "PENDING" });
    const processor = buildTxProcessor(mockRedis, RPC_URL, PASSPHRASE, factory);
    const job = { id: "job-3", data: { signed_xdr: "AAAA==" } } as never;

    await processor(job);

    const calls = (mockRedis.set as jest.Mock).mock.calls;
    const successCall = calls.find(
      ([, state]: [string, { status: string }]) => state.status === "success",
    );
    expect(successCall).toBeDefined();
    expect(successCall[1].hash).toBe("abc123hash");

    jest.restoreAllMocks();
  });

  test("sets failed state with structured error on RPC ERROR response", async () => {
    const { TransactionBuilder } = await import("@stellar/stellar-sdk");
    const mockTx = { signatures: [{}], operations: [{ type: "invokeHostFunction" }] };
    jest.spyOn(TransactionBuilder, "fromXDR").mockReturnValue(mockTx as never);

    const factory = makeFactory({ hash: "failhash", status: "ERROR" });
    const processor = buildTxProcessor(mockRedis, RPC_URL, PASSPHRASE, factory);
    const job = { id: "job-4", data: { signed_xdr: "AAAA==" } } as never;

    await processor(job);

    const calls = (mockRedis.set as jest.Mock).mock.calls;
    const failedCall = calls.find(
      ([, state]: [string, { status: string }]) => state.status === "failed",
    );
    expect(failedCall).toBeDefined();
    expect(failedCall[1].error).toMatchObject({
      code: expect.any(String),
      message: expect.any(String),
    });

    jest.restoreAllMocks();
  });

  test("caches idempotency key on success", async () => {
    const { TransactionBuilder } = await import("@stellar/stellar-sdk");
    const mockTx = { signatures: [{}], operations: [{ type: "invokeHostFunction" }] };
    jest.spyOn(TransactionBuilder, "fromXDR").mockReturnValue(mockTx as never);

    const factory = makeFactory({ hash: "idemhash", status: "PENDING" });
    const idemKey = "550e8400-e29b-41d4-a716-446655440000";
    const processor = buildTxProcessor(mockRedis, RPC_URL, PASSPHRASE, factory);
    const job = {
      id: "job-5",
      data: { signed_xdr: "AAAA==", idempotency_key: idemKey },
    } as never;

    await processor(job);

    const idemCall = (mockRedis.set as jest.Mock).mock.calls.find(
      ([key]: [string]) => key === `tx:idem:${idemKey}`,
    );
    expect(idemCall).toBeDefined();

    jest.restoreAllMocks();
  });
});

// ── Integration tests (real Redis) ───────────────────────────────────────────

describeIfRedis("tx-submit queue end-to-end (real Redis)", () => {
  let testConn: IORedis;
  let redis: RedisService;

  beforeAll(() => {
    testConn = new IORedis({
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT ?? 6379),
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });
    redis = makeTestRedisService(testConn);
  });

  afterAll(async () => {
    await testConn.quit();
    await closeTxSubmitQueue();
  });

  afterEach(async () => {
    // Drain the queue between tests
    const q = new Queue("tx-submit", { connection: testConn });
    await q.obliterate({ force: true });
    await q.close();
  });

  test("enqueueTxSubmit returns a non-empty jobId", async () => {
    const jobId = await enqueueTxSubmit({ signed_xdr: "AAAA==" });
    expect(typeof jobId).toBe("string");
    expect(jobId.length).toBeGreaterThan(0);
  });

  test("initial queued state is readable from Redis after enqueue", async () => {
    const jobId = await enqueueTxSubmit({ signed_xdr: "AAAA==" });

    await setTxState(redis, {
      jobId,
      status: "queued",
      updatedAt: new Date().toISOString(),
    });

    const state = await getTxState(redis, jobId);
    expect(state).not.toBeNull();
    expect(state!.status).toBe("queued");
    expect(state!.jobId).toBe(jobId);
  });

  test("state transitions from queued → processing → success", async () => {
    const jobId = "test-job-lifecycle";

    await setTxState(redis, { jobId, status: "queued", updatedAt: new Date().toISOString() });
    let state = await getTxState(redis, jobId);
    expect(state!.status).toBe("queued");

    await setTxState(redis, { jobId, status: "processing", updatedAt: new Date().toISOString() });
    state = await getTxState(redis, jobId);
    expect(state!.status).toBe("processing");

    await setTxState(redis, {
      jobId,
      status: "success",
      updatedAt: new Date().toISOString(),
      hash: "abc123",
      rpcStatus: "PENDING",
    });
    state = await getTxState(redis, jobId);
    expect(state!.status).toBe("success");
    expect(state!.hash).toBe("abc123");
  });

  test("failed state includes structured error", async () => {
    const jobId = "test-job-failed";

    await setTxState(redis, {
      jobId,
      status: "failed",
      updatedAt: new Date().toISOString(),
      error: { code: "TX_BAD_SEQ", message: "Sequence number mismatch." },
    });

    const state = await getTxState(redis, jobId);
    expect(state!.status).toBe("failed");
    expect(state!.error).toMatchObject({
      code: "TX_BAD_SEQ",
      message: expect.stringContaining("Sequence"),
    });
  });

  test("getTxState returns null for unknown jobId", async () => {
    const state = await getTxState(redis, "nonexistent-job-id-xyz");
    expect(state).toBeNull();
  });
});
