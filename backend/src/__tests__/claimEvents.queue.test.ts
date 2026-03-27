/**
 * claim-events queue end-to-end test.
 *
 * Verifies that a job enqueued by the producer is picked up and processed
 * by the worker. Requires a running Redis instance.
 */

import { enqueueClaimEvent, ClaimEventJobData, closeClaimEventsQueue } from "../queues/claimEvents.queue";
import { startClaimEventsWorker } from "../queues/claimEvents.worker";
import { closeRedisClient } from "../redis/client";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const REDIS_AVAILABLE = process.env.REDIS_HOST !== undefined || process.env.CI === "true";
const describeIfRedis = REDIS_AVAILABLE ? describe : describe.skip;

describeIfRedis("claim-events queue end-to-end", () => {
  let worker: ReturnType<typeof startClaimEventsWorker>;
  let processedJobs: ClaimEventJobData[];
  // Use a dedicated connection per test suite to avoid closing the shared client
  let testConn: IORedis;

  beforeAll(() => {
    testConn = new IORedis({
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT ?? 6379),
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });
  });

  afterAll(async () => {
    await testConn.quit();
    await closeClaimEventsQueue();
    await closeRedisClient();
  });

  beforeEach(() => {
    processedJobs = [];
    worker = startClaimEventsWorker(async (job) => {
      processedJobs.push(job.data);
    });
  });

  afterEach(async () => {
    await worker.close();
    // Drain the queue between tests using the dedicated connection
    const q = new Queue("claim-events", { connection: testConn });
    await q.obliterate({ force: true });
    await q.close();
  });

  test("enqueued job is processed by worker", async () => {
    const data: ClaimEventJobData = {
      eventType: "claim:filed",
      ledger: 12345,
      payload: JSON.stringify({ claim_id: 1, amount: 100_000 }),
    };

    const jobId = await enqueueClaimEvent(data);
    expect(jobId).toBeTruthy();

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("job not processed in time")), 10_000);
      worker.on("completed", () => {
        clearTimeout(timeout);
        resolve();
      });
      worker.on("failed", (_job: unknown, err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    expect(processedJobs).toHaveLength(1);
    expect(processedJobs[0].eventType).toBe("claim:filed");
    expect(processedJobs[0].ledger).toBe(12345);
  });

  test("failed job is retried", async () => {
    let attempts = 0;
    const failingWorker = startClaimEventsWorker(async () => {
      attempts++;
      if (attempts < 2) throw new Error("transient failure");
    });

    const data: ClaimEventJobData = {
      eventType: "vote:logged",
      ledger: 99,
      payload: "{}",
    };

    await enqueueClaimEvent(data);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("retry not observed")), 20_000);
      failingWorker.on("completed", () => {
        clearTimeout(timeout);
        resolve();
      });
      failingWorker.on("error", (err: Error) => {
        // ignore offline-queue errors during close
        if (err.message.includes("enableOfflineQueue")) return;
        clearTimeout(timeout);
        reject(err);
      });
    });

    expect(attempts).toBeGreaterThanOrEqual(2);
    await failingWorker.close();
  }, 30_000); // explicit timeout — retry cycle needs more than 5 s
});

describe("queue module (unit — no Redis)", () => {
  test("ClaimEventJobData shape is correct", () => {
    const data: ClaimEventJobData = {
      eventType: "claim:settled",
      ledger: 1,
      payload: "{}",
    };
    expect(data.eventType).toBe("claim:settled");
  });
});
