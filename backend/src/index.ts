import express from "express";
import { checkRedisHealth, closeRedisClient } from "./redis/client";
import { collectRedisMetrics } from "./redis/metrics";

const app = express();
app.use(express.json());

/** Basic liveness probe — always returns 200 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

/**
 * Readiness probe — includes Redis connectivity.
 * Returns 200 if Redis is up, 503 if not.
 * Kubernetes / load-balancer can use this to gate traffic.
 */
app.get("/health/ready", async (_req, res) => {
  const redisOk = await checkRedisHealth();
  res.status(redisOk ? 200 : 503).json({
    status: redisOk ? "ok" : "degraded",
    redis: redisOk ? "up" : "down",
  });
});

/**
 * Redis metrics endpoint — queue depths and memory usage.
 * Wire a Prometheus scraper or alerting rule against:
 *   queues["claim-events"].depth > 1000  → scale workers
 *   memory_used_mb > threshold           → eviction risk
 */
app.get("/metrics/redis", async (_req, res) => {
  const metrics = await collectRedisMetrics();
  res.json(metrics);
});

export { closeRedisClient };
export default app;
