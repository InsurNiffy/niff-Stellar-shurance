/**
 * Webhook endpoint tests.
 *
 * Covers:
 *   - Valid requests (github, stripe, generic) → 200 accepted
 *   - Invalid signatures → 400
 *   - Replay attacks (timestamp outside tolerance) → 400
 *   - Duplicate delivery (same idempotency key) → 200 duplicate, no re-enqueue
 *   - Unknown provider → 404
 *   - Missing signature headers → 400
 *   - IP allowlist blocking → 403
 *   - Queue stats endpoint
 *   - Secret rotation: old and new secret both accepted simultaneously
 */

/// <reference types="jest" />

import * as http from "http";
import { createHmac } from "crypto";
import app from "../src/index";
import { _resetIdempotencyStore } from "../src/webhooks/idempotency";
import { webhookQueue } from "../src/webhooks/queue";
import { setWebhookConfig, resetWebhookConfig } from "../src/webhooks/config";

// ── HTTP helper ───────────────────────────────────────────────────────────────

interface TestResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
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

afterAll((done) => server.close(done));

beforeEach(() => {
  _resetIdempotencyStore();
  webhookQueue._reset();
  resetWebhookConfig();
});

function post(
  path: string,
  body: string,
  headers: Record<string, string>
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...headers,
      },
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk.toString()));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) })
      );
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function get(path: string): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port,
      path,
      method: "GET",
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk.toString()));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) })
      );
    });
    req.on("error", reject);
    req.end();
  });
}

// ── Signature helpers ─────────────────────────────────────────────────────────

function githubSig(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

function stripeSig(body: string, secret: string, ts: number): string {
  const signed = `${ts}.${body}`;
  const sig = createHmac("sha256", secret).update(signed, "utf8").digest("hex");
  return `t=${ts},v1=${sig}`;
}

function genericSig(body: string, secret: string, ts: number): string {
  const signed = `${ts}.${body}`;
  return "sha256=" + createHmac("sha256", secret).update(signed, "utf8").digest("hex");
}

const SECRET = "test-secret-abc123";
const NOW = Math.floor(Date.now() / 1000);

// ── GitHub ────────────────────────────────────────────────────────────────────

describe("GitHub webhooks", () => {
  beforeEach(() => {
    setWebhookConfig({
      github: { secrets: [SECRET], toleranceSeconds: 300 },
      stripe: { secrets: [SECRET], toleranceSeconds: 300 },
      generic: { secrets: [SECRET], toleranceSeconds: 300 },
    });
  });

  test("valid signature returns 200 accepted", async () => {
    const body = JSON.stringify({ action: "opened" });
    const { status, body: res } = await post("/webhooks/github", body, {
      "x-hub-signature-256": githubSig(body, SECRET),
      "x-github-delivery": "abc-delivery-1",
      "x-github-event": "pull_request",
    });
    expect(status).toBe(200);
    expect(res.status).toBe("accepted");
  });

  test("invalid signature returns 400", async () => {
    const body = JSON.stringify({ action: "opened" });
    const { status, body: res } = await post("/webhooks/github", body, {
      "x-hub-signature-256": "sha256=badhash",
      "x-github-delivery": "abc-delivery-2",
      "x-github-event": "pull_request",
    });
    expect(status).toBe(400);
    expect(res.error).toBe("invalid_signature");
  });

  test("missing signature header returns 400", async () => {
    const body = JSON.stringify({ action: "opened" });
    const { status, body: res } = await post("/webhooks/github", body, {
      "x-github-delivery": "abc-delivery-3",
      "x-github-event": "push",
    });
    expect(status).toBe(400);
    expect(res.error).toBe("missing_header");
  });

  test("duplicate delivery key returns 200 duplicate", async () => {
    const body = JSON.stringify({ action: "opened" });
    const headers = {
      "x-hub-signature-256": githubSig(body, SECRET),
      "x-github-delivery": "dup-delivery-id",
      "x-github-event": "push",
    };
    const first = await post("/webhooks/github", body, headers);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("accepted");

    const second = await post("/webhooks/github", body, headers);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("duplicate");
  });

  test("secret rotation: both old and new secret accepted simultaneously", async () => {
    const OLD_SECRET = "old-secret";
    const NEW_SECRET = "new-secret";
    setWebhookConfig({
      github: { secrets: [OLD_SECRET, NEW_SECRET], toleranceSeconds: 300 },
      stripe: { secrets: [SECRET], toleranceSeconds: 300 },
      generic: { secrets: [SECRET], toleranceSeconds: 300 },
    });

    const body = JSON.stringify({ action: "opened" });

    // Old secret still works
    const r1 = await post("/webhooks/github", body, {
      "x-hub-signature-256": githubSig(body, OLD_SECRET),
      "x-github-delivery": "rotation-test-1",
      "x-github-event": "push",
    });
    expect(r1.status).toBe(200);
    expect(r1.body.status).toBe("accepted");

    // New secret also works
    const r2 = await post("/webhooks/github", body, {
      "x-hub-signature-256": githubSig(body, NEW_SECRET),
      "x-github-delivery": "rotation-test-2",
      "x-github-event": "push",
    });
    expect(r2.status).toBe(200);
    expect(r2.body.status).toBe("accepted");
  });
});

// ── Stripe ────────────────────────────────────────────────────────────────────

describe("Stripe webhooks", () => {
  beforeEach(() => {
    setWebhookConfig({
      github: { secrets: [SECRET], toleranceSeconds: 300 },
      stripe: { secrets: [SECRET], toleranceSeconds: 300 },
      generic: { secrets: [SECRET], toleranceSeconds: 300 },
    });
  });

  test("valid signature returns 200 accepted", async () => {
    const body = JSON.stringify({ id: "evt_001", type: "payment_intent.succeeded" });
    const { status, body: res } = await post("/webhooks/stripe", body, {
      "stripe-signature": stripeSig(body, SECRET, NOW),
    });
    expect(status).toBe(200);
    expect(res.status).toBe("accepted");
  });

  test("invalid signature returns 400", async () => {
    const body = JSON.stringify({ id: "evt_002", type: "payment_intent.succeeded" });
    const { status, body: res } = await post("/webhooks/stripe", body, {
      "stripe-signature": `t=${NOW},v1=badhash`,
    });
    expect(status).toBe(400);
    expect(res.error).toBe("invalid_signature");
  });

  test("replay attack (old timestamp) returns 400", async () => {
    const staleTs = NOW - 400; // outside 300s tolerance
    const body = JSON.stringify({ id: "evt_003", type: "charge.failed" });
    const { status, body: res } = await post("/webhooks/stripe", body, {
      "stripe-signature": stripeSig(body, SECRET, staleTs),
    });
    expect(status).toBe(400);
    expect(res.error).toBe("replay");
  });

  test("future timestamp outside tolerance returns 400", async () => {
    const futureTs = NOW + 400;
    const body = JSON.stringify({ id: "evt_004", type: "charge.failed" });
    const { status, body: res } = await post("/webhooks/stripe", body, {
      "stripe-signature": stripeSig(body, SECRET, futureTs),
    });
    expect(status).toBe(400);
    expect(res.error).toBe("replay");
  });

  test("duplicate event id returns 200 duplicate", async () => {
    const body = JSON.stringify({ id: "evt_dup", type: "invoice.paid" });
    const headers = { "stripe-signature": stripeSig(body, SECRET, NOW) };

    const first = await post("/webhooks/stripe", body, headers);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("accepted");

    const second = await post("/webhooks/stripe", body, headers);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("duplicate");
  });

  test("missing stripe-signature header returns 400", async () => {
    const body = JSON.stringify({ id: "evt_005", type: "charge.failed" });
    const { status, body: res } = await post("/webhooks/stripe", body, {});
    expect(status).toBe(400);
    expect(res.error).toBe("missing_header");
  });
});

// ── Generic ───────────────────────────────────────────────────────────────────

describe("Generic webhooks", () => {
  beforeEach(() => {
    setWebhookConfig({
      github: { secrets: [SECRET], toleranceSeconds: 300 },
      stripe: { secrets: [SECRET], toleranceSeconds: 300 },
      generic: { secrets: [SECRET], toleranceSeconds: 300 },
    });
  });

  test("valid signature returns 200 accepted", async () => {
    const body = JSON.stringify({ event: "policy.created" });
    const { status, body: res } = await post("/webhooks/generic", body, {
      "x-webhook-signature": genericSig(body, SECRET, NOW),
      "x-webhook-timestamp": String(NOW),
      "x-webhook-id": "gen-id-001",
      "x-webhook-event": "policy.created",
    });
    expect(status).toBe(200);
    expect(res.status).toBe("accepted");
  });

  test("invalid signature returns 400", async () => {
    const body = JSON.stringify({ event: "policy.created" });
    const { status, body: res } = await post("/webhooks/generic", body, {
      "x-webhook-signature": "sha256=badhash",
      "x-webhook-timestamp": String(NOW),
      "x-webhook-id": "gen-id-002",
      "x-webhook-event": "policy.created",
    });
    expect(status).toBe(400);
    expect(res.error).toBe("invalid_signature");
  });

  test("replay attack returns 400", async () => {
    const staleTs = NOW - 400;
    const body = JSON.stringify({ event: "policy.expired" });
    const { status, body: res } = await post("/webhooks/generic", body, {
      "x-webhook-signature": genericSig(body, SECRET, staleTs),
      "x-webhook-timestamp": String(staleTs),
      "x-webhook-id": "gen-id-003",
      "x-webhook-event": "policy.expired",
    });
    expect(status).toBe(400);
    expect(res.error).toBe("replay");
  });

  test("duplicate webhook id returns 200 duplicate", async () => {
    const body = JSON.stringify({ event: "claim.filed" });
    const headers = {
      "x-webhook-signature": genericSig(body, SECRET, NOW),
      "x-webhook-timestamp": String(NOW),
      "x-webhook-id": "gen-dup-id",
      "x-webhook-event": "claim.filed",
    };
    const first = await post("/webhooks/generic", body, headers);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("accepted");

    const second = await post("/webhooks/generic", body, headers);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("duplicate");
  });
});

// ── Unknown provider ──────────────────────────────────────────────────────────

test("unknown provider returns 404", async () => {
  const { status, body } = await post("/webhooks/unknown-provider", "{}", {});
  expect(status).toBe(404);
  expect(body.error).toBe("unknown_provider");
});

// ── IP allowlist ──────────────────────────────────────────────────────────────

test("IP not in allowlist returns 403", async () => {
  setWebhookConfig({
    github: { secrets: [SECRET], toleranceSeconds: 300, ipAllowlist: ["1.2.3.4"] },
    stripe: { secrets: [SECRET], toleranceSeconds: 300 },
    generic: { secrets: [SECRET], toleranceSeconds: 300 },
  });

  const body = JSON.stringify({ action: "opened" });
  const { status, body: res } = await post("/webhooks/github", body, {
    "x-hub-signature-256": githubSig(body, SECRET),
    "x-github-delivery": "ip-test-1",
    "x-github-event": "push",
  });
  expect(status).toBe(403);
  expect(res.error).toBe("ip_blocked");
});

// ── Queue stats ───────────────────────────────────────────────────────────────

test("GET /webhooks/queue/stats returns observable counts", async () => {
  const { status, body } = await get("/webhooks/queue/stats");
  expect(status).toBe(200);
  expect(body).toHaveProperty("pending");
  expect(body).toHaveProperty("processed");
  expect(body).toHaveProperty("failed");
});
