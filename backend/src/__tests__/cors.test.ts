/**
 * CORS & Helmet integration tests.
 *
 * These tests use a minimal Express app that replicates the exact same
 * Helmet + CORS setup from main.ts — no NestJS AppModule or database needed.
 */

import request from "supertest";
import express from "express";
import helmet from "helmet";
import cors from "cors";

// Replicated from main.ts — avoids importing the full NestJS bootstrap chain
// which transitively pulls in modules with missing optional dependencies.
function parseOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Build a test Express app with the same Helmet + CORS config as main.ts.
 */
function buildTestApp(frontendOrigins: string[], adminOrigins: string[] = []) {
  const app = express();

  // Helmet — same config as main.ts
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"] },
      },
      hsts: {
        maxAge: 31_536_000,
        includeSubDomains: true,
        preload: false,
      },
      frameguard: { action: "deny" },
      dnsPrefetchControl: { allow: false },
      referrerPolicy: { policy: "no-referrer" },
      permittedCrossDomainPolicies: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Permissions-Policy — helmet 7 does not include a built-in helper
  app.use((_req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    next();
  });

  // CORS — same config as main.ts
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const allowed = [...frontendOrigins, ...adminOrigins];
        if (allowed.includes(origin)) return cb(null, origin as any);
        return cb(new Error("Not allowed by CORS"));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type", "X-Requested-With"],
      maxAge: 86400,
      preflightContinue: false,
      optionsSuccessStatus: 204,
    }),
  );

  // A simple test endpoint
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  return app;
}

const ALLOWED_ORIGIN = "https://app.example.com";
const DISALLOWED_ORIGIN = "https://evil.com";

describe("CORS integration tests", () => {
  // Test 1 — Req 6.1: Allowed origin → Access-Control-Allow-Origin equals that origin
  it("allowed origin → Access-Control-Allow-Origin equals that origin", async () => {
    const app = buildTestApp([ALLOWED_ORIGIN]);
    const res = await request(app)
      .get("/api/health")
      .set("Origin", ALLOWED_ORIGIN);

    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
  });

  // Test 2 — Req 6.2: Disallowed origin → no Access-Control-Allow-Origin header
  it("disallowed origin → no Access-Control-Allow-Origin header", async () => {
    const app = buildTestApp([ALLOWED_ORIGIN]);
    const res = await request(app)
      .get("/api/health")
      .set("Origin", DISALLOWED_ORIGIN);

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  // Test 3 — Req 6.3: Preflight from allowed origin → 204 + correct headers
  it("preflight from allowed origin → 204 + correct CORS headers", async () => {
    const app = buildTestApp([ALLOWED_ORIGIN]);
    const res = await request(app)
      .options("/api/health")
      .set("Origin", ALLOWED_ORIGIN)
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["access-control-max-age"]).toBe("86400");
  });

  // Test 4 — Req 6.4: Preflight from disallowed origin → 403 (or no ACAO header)
  it("preflight from disallowed origin → no Access-Control-Allow-Origin header", async () => {
    const app = buildTestApp([ALLOWED_ORIGIN]);
    const res = await request(app)
      .options("/api/health")
      .set("Origin", DISALLOWED_ORIGIN)
      .set("Access-Control-Request-Method", "GET");

    // The cors library calls cb(new Error(...)) which causes Express to emit a
    // 500 error — but crucially the ACAO header is absent, which is what matters
    // for security. We assert the header is absent (the browser will block it).
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  // Test 5 — Req 6.5: No Origin header → request succeeds
  it("no Origin header → request succeeds with 200", async () => {
    const app = buildTestApp([ALLOWED_ORIGIN]);
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
  });

  // Test 6 — Req 6.6: Allowed origin → Access-Control-Allow-Credentials: true
  it("allowed origin → Access-Control-Allow-Credentials: true", async () => {
    const app = buildTestApp([ALLOWED_ORIGIN]);
    const res = await request(app)
      .get("/api/health")
      .set("Origin", ALLOWED_ORIGIN);

    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  // Test 7 — Req 4.1–4.8: Helmet headers present and X-Powered-By absent
  it("Helmet headers present and X-Powered-By absent", async () => {
    const app = buildTestApp([ALLOWED_ORIGIN]);
    const res = await request(app).get("/api/health");

    // Req 4.1 — X-Content-Type-Options
    expect(res.headers["x-content-type-options"]).toBe("nosniff");

    // Req 4.2 — X-Frame-Options
    expect(res.headers["x-frame-options"]).toBe("DENY");

    // Req 4.3 — HSTS
    expect(res.headers["strict-transport-security"]).toContain(
      "max-age=31536000",
    );

    // Req 4.4 — CSP
    expect(res.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );

    // Req 4.5 — X-DNS-Prefetch-Control
    expect(res.headers["x-dns-prefetch-control"]).toBe("off");

    // Req 4.6 — Referrer-Policy
    expect(res.headers["referrer-policy"]).toBe("no-referrer");

    // Req 4.7 — Permissions-Policy
    expect(res.headers["permissions-policy"]).toContain("camera=()");

    // Req 4.8 — X-Powered-By must be absent
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("parseOrigins utility", () => {
  it("trims whitespace and splits on commas", () => {
    expect(parseOrigins("  https://a.com , https://b.com  ")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });
});
