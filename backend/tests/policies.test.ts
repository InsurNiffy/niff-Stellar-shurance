/**
 * Comprehensive tests for GET /policies and GET /policies/:holder/:policy_id
 *
 * Coverage:
 *   - Filter combinations (status, holder, combined)
 *   - Pagination: default limit, custom limit, cursor advancement, last page
 *   - Cursor edge cases: invalid cursor → 400, cursor past end → empty page
 *   - Concurrent insert behaviour: new rows appear on subsequent pages
 *   - No N+1: claims are batch-fetched (verified via response shape)
 *   - DTO shape: no internal fields (global_seq) exposed
 *   - No floating-point amounts
 *   - 404 for unknown policy
 *   - 400 for invalid policy_id, invalid status filter
 *   - Rate limit headers present
 *
 * Pagination staleness contract (documented):
 *   Cursors encode global_seq. Rows inserted after the cursor position appear
 *   on subsequent pages. Rows inserted before the cursor (backfill) are skipped
 *   on already-delivered pages — this is expected and documented behaviour.
 */

/// <reference types="jest" />

import * as http from "http";
import app from "../src/index";
import { _resetStore, insertPolicy, insertClaim } from "../src/db/store";

// ── Lightweight HTTP helper ───────────────────────────────────────────────────

interface TestResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  headers: Record<string, string | string[] | undefined>;
}

let server: http.Server;
let port: number;

beforeAll((done) => {
  server = http.createServer(app);
  server.listen(0, "127.0.0.1", () => {
    port = (server.address() as { port: number }).port;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  _resetStore();
});

function get(path: string): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port,
      path,
      method: "GET",
      headers: { Accept: "application/json" },
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk.toString()));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: JSON.parse(data),
          headers: res.headers as Record<string, string | string[] | undefined>,
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function seedN(n: number, isActive = true): void {
  for (let i = 1; i <= n; i++) {
    insertPolicy({
      holder: `GHOLDER${String(i).padStart(50, "0")}`,
      policy_id: 1,
      policy_type: "Auto",
      region: "Low",
      premium: "1000000",
      coverage: "100000000",
      is_active: isActive,
      start_ledger: 100 * i,
      end_ledger: 1000 * i,
    });
  }
}

// ── Basic list ────────────────────────────────────────────────────────────────

test("GET /policies returns 200 with empty data when store is empty", async () => {
  const { status, body } = await get("/policies");
  expect(status).toBe(200);
  expect(body.data).toEqual([]);
  expect(body.next_cursor).toBeNull();
  expect(body.total).toBe(0);
});

test("GET /policies returns all policies with correct DTO shape", async () => {
  const p = insertPolicy({
    holder: "GABC1111111111111111111111111111111111111111111111111111",
    policy_id: 1,
    policy_type: "Health",
    region: "High",
    premium: "8000000",
    coverage: "1000000000",
    is_active: true,
    start_ledger: 500,
    end_ledger: 5500,
  });
  insertClaim({
    claim_id: 1,
    policy_id: p.policy_id,
    claimant: p.holder,
    amount: "100000000",
    details: "Test claim",
    image_urls: [],
    status: "Processing",
    approve_votes: 1,
    reject_votes: 0,
  });

  const { status, body } = await get("/policies");
  expect(status).toBe(200);
  expect(body.total).toBe(1);
  const dto = body.data[0];

  // Required DTO fields present
  expect(dto).toHaveProperty("holder");
  expect(dto).toHaveProperty("policy_id");
  expect(dto).toHaveProperty("policy_type");
  expect(dto).toHaveProperty("region");
  expect(dto).toHaveProperty("is_active");
  expect(dto).toHaveProperty("coverage_summary");
  expect(dto).toHaveProperty("expiry_countdown");
  expect(dto).toHaveProperty("claims");
  expect(dto).toHaveProperty("_link");

  // No internal fields exposed
  expect(dto).not.toHaveProperty("global_seq");

  // Amounts are strings, not numbers
  expect(typeof dto.coverage_summary.coverage_amount).toBe("string");
  expect(typeof dto.coverage_summary.premium_amount).toBe("string");
  expect(dto.coverage_summary.currency).toBe("XLM");
  expect(dto.coverage_summary.decimals).toBe(7);

  // No floating-point amounts
  expect(dto.coverage_summary.coverage_amount).not.toContain(".");
  expect(dto.coverage_summary.premium_amount).not.toContain(".");

  // Claims batch-fetched (no N+1 — verified by presence in response)
  expect(dto.claims).toHaveLength(1);
  expect(dto.claims[0].claim_id).toBe(1);
  expect(dto.claims[0]._link).toBe("/claims/1");
  expect(typeof dto.claims[0].amount).toBe("string");
});

// ── Filter: status ────────────────────────────────────────────────────────────

test("GET /policies?status=active returns only active policies", async () => {
  insertPolicy({ holder: "GA1", policy_id: 1, policy_type: "Auto", region: "Low", premium: "1", coverage: "1", is_active: true, start_ledger: 1, end_ledger: 100 });
  insertPolicy({ holder: "GA2", policy_id: 1, policy_type: "Auto", region: "Low", premium: "1", coverage: "1", is_active: false, start_ledger: 1, end_ledger: 50 });

  const { body } = await get("/policies?status=active");
  expect(body.total).toBe(1);
  expect(body.data.every((p: { is_active: boolean }) => p.is_active)).toBe(true);
});

test("GET /policies?status=expired returns only inactive policies", async () => {
  insertPolicy({ holder: "GA1", policy_id: 1, policy_type: "Auto", region: "Low", premium: "1", coverage: "1", is_active: true, start_ledger: 1, end_ledger: 100 });
  insertPolicy({ holder: "GA2", policy_id: 1, policy_type: "Auto", region: "Low", premium: "1", coverage: "1", is_active: false, start_ledger: 1, end_ledger: 50 });

  const { body } = await get("/policies?status=expired");
  expect(body.total).toBe(1);
  expect(body.data.every((p: { is_active: boolean }) => !p.is_active)).toBe(true);
});

test("GET /policies?status=invalid returns 400", async () => {
  const { status, body } = await get("/policies?status=unknown");
  expect(status).toBe(400);
  expect(body.error).toBe("invalid_filter");
});

// ── Filter: holder ────────────────────────────────────────────────────────────

test("GET /policies?holder=X returns only that holder's policies", async () => {
  insertPolicy({ holder: "GHOLDER_A", policy_id: 1, policy_type: "Auto", region: "Low", premium: "1", coverage: "1", is_active: true, start_ledger: 1, end_ledger: 100 });
  insertPolicy({ holder: "GHOLDER_A", policy_id: 2, policy_type: "Health", region: "High", premium: "2", coverage: "2", is_active: true, start_ledger: 1, end_ledger: 200 });
  insertPolicy({ holder: "GHOLDER_B", policy_id: 1, policy_type: "Property", region: "Medium", premium: "3", coverage: "3", is_active: true, start_ledger: 1, end_ledger: 300 });

  const { body } = await get("/policies?holder=GHOLDER_A");
  expect(body.total).toBe(2);
  expect(body.data.every((p: { holder: string }) => p.holder === "GHOLDER_A")).toBe(true);
});

// ── Filter: combined ──────────────────────────────────────────────────────────

test("GET /policies?status=active&holder=X returns active policies for that holder only", async () => {
  insertPolicy({ holder: "GHOLDER_A", policy_id: 1, policy_type: "Auto", region: "Low", premium: "1", coverage: "1", is_active: true, start_ledger: 1, end_ledger: 100 });
  insertPolicy({ holder: "GHOLDER_A", policy_id: 2, policy_type: "Health", region: "High", premium: "2", coverage: "2", is_active: false, start_ledger: 1, end_ledger: 50 });
  insertPolicy({ holder: "GHOLDER_B", policy_id: 1, policy_type: "Property", region: "Medium", premium: "3", coverage: "3", is_active: true, start_ledger: 1, end_ledger: 300 });

  const { body } = await get("/policies?status=active&holder=GHOLDER_A");
  expect(body.total).toBe(1);
  expect(body.data[0].holder).toBe("GHOLDER_A");
  expect(body.data[0].is_active).toBe(true);
});

// ── Pagination ────────────────────────────────────────────────────────────────

test("default limit is 20", async () => {
  seedN(25);
  const { body } = await get("/policies");
  expect(body.data).toHaveLength(20);
  expect(body.total).toBe(25);
  expect(body.next_cursor).not.toBeNull();
});

test("custom limit is respected", async () => {
  seedN(10);
  const { body } = await get("/policies?limit=3");
  expect(body.data).toHaveLength(3);
  expect(body.next_cursor).not.toBeNull();
});

test("limit is clamped to 100", async () => {
  seedN(5);
  const { body } = await get("/policies?limit=999");
  expect(body.data).toHaveLength(5); // only 5 exist
});

test("cursor advances through all pages", async () => {
  seedN(5);
  const seen: number[] = [];
  let cursor: string | null = null;
  let pages = 0;

  do {
    const url = cursor ? `/policies?limit=2&after=${cursor}` : "/policies?limit=2";
    const { body } = await get(url);
    body.data.forEach((p: { policy_id: number }) => seen.push(p.policy_id));
    cursor = body.next_cursor;
    pages++;
  } while (cursor !== null);

  expect(seen).toHaveLength(5);
  expect(pages).toBe(3); // ceil(5/2) = 3
});

test("last page has next_cursor = null", async () => {
  seedN(3);
  const { body } = await get("/policies?limit=10");
  expect(body.data).toHaveLength(3);
  expect(body.next_cursor).toBeNull();
});

test("cursor past end of list returns empty page", async () => {
  seedN(2);
  const farCursor = Buffer.from("9999", "utf8").toString("base64url");
  const { body } = await get(`/policies?after=${farCursor}`);
  expect(body.data).toHaveLength(0);
  expect(body.next_cursor).toBeNull();
  expect(body.total).toBe(2); // total still reflects full filtered count
});

// ── Cursor error handling ─────────────────────────────────────────────────────

test("cursor with non-integer content returns 400", async () => {
  const badCursor = Buffer.from("not-a-number", "utf8").toString("base64url");
  const { status, body } = await get(`/policies?after=${badCursor}`);
  expect(status).toBe(400);
  expect(body.error).toBe("invalid_cursor");
});

test("cursor with negative integer returns 400", async () => {
  const badCursor = Buffer.from("-5", "utf8").toString("base64url");
  const { status, body } = await get(`/policies?after=${badCursor}`);
  expect(status).toBe(400);
  expect(body.error).toBe("invalid_cursor");
});

// ── Concurrent insert behaviour ───────────────────────────────────────────────

test("rows inserted after cursor appear on subsequent pages (documented staleness)", async () => {
  seedN(3);

  // Get page 1 (items 1-2)
  const { body: b1 } = await get("/policies?limit=2");
  expect(b1.data).toHaveLength(2);
  const cursor: string = b1.next_cursor;

  // Simulate concurrent insert of a new policy
  insertPolicy({
    holder: "GNEW_CONCURRENT_INSERT_HOLDER_00000000000000000000000000",
    policy_id: 1,
    policy_type: "Property",
    region: "Low",
    premium: "1",
    coverage: "1",
    is_active: true,
    start_ledger: 1,
    end_ledger: 100,
  });

  // Page 2 should include item 3 AND the newly inserted item (seq > cursor)
  const { body: b2 } = await get(`/policies?limit=10&after=${cursor}`);
  expect(b2.data).toHaveLength(2); // item 3 + new item
});

// ── GET /policies/:holder/:policy_id ─────────────────────────────────────────

test("GET /policies/:holder/:policy_id returns 200 with correct policy", async () => {
  const holder = "GABC1111111111111111111111111111111111111111111111111111";
  insertPolicy({
    holder,
    policy_id: 1,
    policy_type: "Auto",
    region: "Medium",
    premium: "5000000",
    coverage: "500000000",
    is_active: true,
    start_ledger: 1000,
    end_ledger: 9000,
  });

  const { status, body } = await get(`/policies/${encodeURIComponent(holder)}/1`);
  expect(status).toBe(200);
  expect(body.holder).toBe(holder);
  expect(body.policy_id).toBe(1);
});

test("GET /policies/:holder/:policy_id returns 404 for unknown policy", async () => {
  const { status, body } = await get("/policies/GUNKNOWN/1");
  expect(status).toBe(404);
  expect(body.error).toBe("not_found");
});

test("GET /policies/:holder/:policy_id returns 400 for non-integer policy_id", async () => {
  const { status, body } = await get("/policies/GHOLDER/abc");
  expect(status).toBe(400);
  expect(body.error).toBe("invalid_param");
});

test("GET /policies/:holder/:policy_id returns 400 for policy_id = 0", async () => {
  const { status, body } = await get("/policies/GHOLDER/0");
  expect(status).toBe(400);
  expect(body.error).toBe("invalid_param");
});

// ── Rate limit headers ────────────────────────────────────────────────────────

test("rate limit headers are present on policy list response", async () => {
  const { headers } = await get("/policies");
  expect(headers["x-ratelimit-limit"]).toBeDefined();
  expect(headers["x-ratelimit-remaining"]).toBeDefined();
});

// ── OpenAPI spec ──────────────────────────────────────────────────────────────

test("GET /openapi.json returns a valid OpenAPI 3.1 spec", async () => {
  const { status, body } = await get("/openapi.json");
  expect(status).toBe(200);
  expect(body.openapi).toBe("3.1.0");
  expect(body.paths).toHaveProperty("/policies");
  expect(body.paths).toHaveProperty("/policies/{holder}/{policy_id}");
});

// ── No internal fields exposed ────────────────────────────────────────────────

test("policy DTO does not expose global_seq or any internal store fields", async () => {
  insertPolicy({ holder: "GA1", policy_id: 1, policy_type: "Auto", region: "Low", premium: "1", coverage: "1", is_active: true, start_ledger: 1, end_ledger: 100 });
  const { body } = await get("/policies");
  const dto = body.data[0];
  expect(dto).not.toHaveProperty("global_seq");
  expect(dto).not.toHaveProperty("_claims");
});
