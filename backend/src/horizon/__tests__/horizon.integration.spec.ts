/**
 * Horizon proxy integration tests.
 *
 * Uses mocked fetch and mocked Redis — no real Horizon credentials required.
 * Covers: field filtering, rate limiting, 429 response, cache hit, address validation.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, HttpStatus } from "@nestjs/common";
import * as request from "supertest";
import { ConfigModule } from "@nestjs/config";
import { HorizonModule } from "../horizon.module";
import { RedisService } from "../../cache/redis.service";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_ACCOUNT = "GBCPNZ6S7RK5N4BX6HBXBCX7P5QNBOJZFGDWBZBXCLK5T6KHWOPTLR3I";

const MOCK_HORIZON_RESPONSE = {
  _links: {
    self: {
      href: "https://horizon-testnet.stellar.org/accounts/G.../operations?limit=20",
    },
    next: {
      href: "https://horizon-testnet.stellar.org/accounts/G.../operations?cursor=abc123&limit=20",
    },
  },
  _embedded: {
    records: [
      {
        id: "1234567890",
        paging_token: "token-1",
        type: "payment",
        type_int: 1,
        created_at: "2024-01-15T10:00:00Z",
        transaction_hash: "aabbcc",
        transaction_successful: true,
        source_account: VALID_ACCOUNT,
        asset_type: "native",
        amount: "100.0000000",
        from: VALID_ACCOUNT,
        to: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        // Fields that must be stripped:
        _links: { self: { href: "..." } },
        offer_id: "99",
        sponsor: "GSOME_SPONSOR",
        funder: "GFUNDER",
      },
      {
        // DEX operation — must be filtered out
        id: "999",
        paging_token: "token-dex",
        type: "manage_sell_offer",
        type_int: 3,
        created_at: "2024-01-15T09:00:00Z",
        transaction_hash: "dex-hash",
        transaction_successful: true,
        source_account: VALID_ACCOUNT,
        offer_id: "42",
        price: "1.5",
      },
    ],
  },
};

// ── Redis mock ────────────────────────────────────────────────────────────────

function createRedisMock() {
  const store = new Map<string, string>();
  return {
    get: jest.fn(async <T>(key: string): Promise<T | null> => {
      const val = store.get(key);
      return val ? (JSON.parse(val) as T) : null;
    }),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, JSON.stringify(value));
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    delPattern: jest.fn(),
    getClient: jest.fn(() => ({
      multi: jest.fn(() => ({
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 1],
          [null, 0], // zcard returns 0 — under limit
          [null, 1],
          [null, 1],
        ]),
      })),
      zremrangebyscore: jest.fn(),
    })),
    ping: jest.fn(async () => true),
    onModuleDestroy: jest.fn(),
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

describe("HorizonController (integration)", () => {
  let app: INestApplication;
  let redisMock: ReturnType<typeof createRedisMock>;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    redisMock = createRedisMock();

    // Mock global fetch — no real Horizon call made
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => MOCK_HORIZON_RESPONSE,
    } as Response);

    // Override STELLAR_NETWORK env so network config does not throw
    process.env.STELLAR_NETWORK = "testnet";
    process.env.STELLAR_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              REDIS_URL: "redis://mock:6379",
              STELLAR_NETWORK: "testnet",
              STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
              SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
              CONTRACT_ID: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
            }),
          ],
        }),
        HorizonModule,
      ],
    })
      .overrideProvider(RedisService)
      .useValue(redisMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  // ── Field filtering ───────────────────────────────────────────────────────

  it("returns only payment operations and strips internal Horizon fields", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/horizon/transactions")
      .query({ account: VALID_ACCOUNT });

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.records).toHaveLength(1); // manage_sell_offer filtered out
    const record = res.body.records[0];

    // Required fields present
    expect(record).toMatchObject({
      id: "1234567890",
      type: "payment",
      amount: "100.0000000",
      transaction_successful: true,
    });

    // Stripped fields must not be present
    expect(record).not.toHaveProperty("_links");
    expect(record).not.toHaveProperty("offer_id");
    expect(record).not.toHaveProperty("sponsor");
    expect(record).not.toHaveProperty("funder");
  });

  it("exposes next_cursor when Horizon provides a next link", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/horizon/transactions")
      .query({ account: VALID_ACCOUNT });

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.next_cursor).toBe("abc123");
  });

  // ── Response headers must not leak API keys ───────────────────────────────

  it("does not expose Authorization or Horizon API key in response headers", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/horizon/transactions")
      .query({ account: VALID_ACCOUNT });

    expect(res.headers).not.toHaveProperty("authorization");
    expect(res.headers).not.toHaveProperty("x-horizon-api-key");
  });

  // ── Address validation ────────────────────────────────────────────────────

  it("returns 400 for a missing account parameter", async () => {
    const res = await request(app.getHttpServer()).get("/api/horizon/transactions");
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it("returns 400 for an invalid Stellar address", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/horizon/transactions")
      .query({ account: "not-a-stellar-address" });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  // ── Cache hit ─────────────────────────────────────────────────────────────

  it("serves from cache on second identical request without calling Horizon again", async () => {
    await request(app.getHttpServer())
      .get("/api/horizon/transactions")
      .query({ account: VALID_ACCOUNT });

    // Seed the cache with what the first request stored
    const cachedValue = { records: [], next_cursor: undefined };
    redisMock.get.mockResolvedValueOnce(cachedValue);

    await request(app.getHttpServer())
      .get("/api/horizon/transactions")
      .query({ account: VALID_ACCOUNT });

    // fetch should only have been called once (the second served from cache)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────

  it("returns 429 with Retry-After header when rate limit is exceeded", async () => {
    // Make zcard return a count at the limit
    redisMock.getClient.mockReturnValue({
      multi: jest.fn(() => ({
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 1],
          [null, 30], // at limit
          [null, 1],
          [null, 1],
        ]),
      })),
      zremrangebyscore: jest.fn(),
    });

    const res = await request(app.getHttpServer())
      .get("/api/horizon/transactions")
      .query({ account: VALID_ACCOUNT });

    expect(res.status).toBe(429);
    expect(res.headers).toHaveProperty("retry-after");
    expect(res.body.error).toBe("Too Many Requests");
  });

  // ── Horizon upstream failure ──────────────────────────────────────────────

  it("returns 502 when Horizon is unreachable", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await request(app.getHttpServer())
      .get("/api/horizon/transactions")
      .query({ account: VALID_ACCOUNT });

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY);
    // Error body must not contain any API key
    expect(JSON.stringify(res.body)).not.toContain("Bearer");
  });
});
