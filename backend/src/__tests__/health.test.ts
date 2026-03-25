/**
 * Health endpoint tests — no Redis required.
 * These run in every CI environment without any service containers.
 */

import request from "supertest";
import app from "../index";

describe("GET /health", () => {
  test("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("GET /health/ready", () => {
  test("returns a status field", async () => {
    // Redis may or may not be available in unit test context.
    // We only assert the response shape, not the specific status code.
    const res = await request(app).get("/health/ready");
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("redis");
    expect(["ok", "degraded"]).toContain(res.body.status);
  });
});

describe("GET /metrics/redis", () => {
  test("returns metrics shape", async () => {
    const res = await request(app).get("/metrics/redis");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("connected");
    expect(res.body).toHaveProperty("queues");
  });
});
