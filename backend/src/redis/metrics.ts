/**
 * Redis metrics: memory usage and queue depth.
 *
 * Exposed via GET /metrics/redis for Prometheus scraping or direct polling.
 * Wire alerts on:
 *   - queue_depth > 1000  → backlog building; scale workers
 *   - memory_used_mb > threshold → eviction risk; increase maxmemory or scale
 */

import { Queue } from "bullmq";
import { getRedisClient, getBullMQConnection } from "./client";
import { QUEUE_NAMES } from "../queues/names";

export interface RedisMetrics {
  connected: boolean;
  memory_used_bytes: number | null;
  memory_used_mb: number | null;
  queues: Record<string, QueueMetrics>;
}

export interface QueueMetrics {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  depth: number; // waiting + active — the "backlog" number to alert on
}

/**
 * Collect Redis memory stats and per-queue depths.
 * Returns partial data if Redis is unavailable (connected: false).
 */
export async function collectRedisMetrics(): Promise<RedisMetrics> {
  const client = getRedisClient();

  let connected = false;
  let memory_used_bytes: number | null = null;

  try {
    const info = await Promise.race([
      client.info("memory"),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 2_000)
      ),
    ]);
    connected = true;
    const match = info.match(/used_memory:(\d+)/);
    if (match) memory_used_bytes = parseInt(match[1], 10);
  } catch {
    // Redis unavailable — return degraded metrics
  }

  const queues: Record<string, QueueMetrics> = {};

  if (connected) {
    for (const name of QUEUE_NAMES) {
      try {
        const conn = getBullMQConnection();
        const q = new Queue(name, { connection: conn });
        const counts = await q.getJobCounts(
          "waiting",
          "active",
          "completed",
          "failed",
          "delayed"
        );
        await q.close();
        await conn.quit();
        queues[name] = {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
          depth: (counts.waiting ?? 0) + (counts.active ?? 0),
        };
      } catch {
        queues[name] = {
          waiting: -1,
          active: -1,
          completed: -1,
          failed: -1,
          delayed: -1,
          depth: -1,
        };
      }
    }
  }

  return {
    connected,
    memory_used_bytes,
    memory_used_mb:
      memory_used_bytes !== null
        ? Math.round(memory_used_bytes / 1024 / 1024)
        : null,
    queues,
  };
}
