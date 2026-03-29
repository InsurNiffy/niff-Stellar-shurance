/**
 * SSE events integration tests.
 *
 * Tests the full pipeline: ClaimEventsService.publish() -> Redis pub/sub ->
 * SseConnectionRegistry.broadcast() -> Subject emission.
 *
 * Uses an in-memory Redis mock (no real Redis required for CI).
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, HttpStatus } from "@nestjs/common";
import * as request from "supertest";
import { ConfigModule } from "@nestjs/config";
import { EventsModule } from "../events.module";
import { ClaimEventsService, ClaimStatusChangedEvent } from "../claim-events.service";
import { SseConnectionRegistry } from "../sse-connection.registry";

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMockRedis() {
  const subscribers: Map<string, ((channel: string, msg: string) => void)[]> = new Map();
  const publishedMessages: { channel: string; message: string }[] = [];

  const instance = {
    _isConnected: false,
    connect: jest.fn(async () => {
      instance._isConnected = true;
    }),
    quit: jest.fn(async () => {}),
    subscribe: jest.fn(async (channel: string) => {
      if (!subscribers.has(channel)) subscribers.set(channel, []);
    }),
    unsubscribe: jest.fn(async () => {}),
    publish: jest.fn(async (channel: string, message: string) => {
      publishedMessages.push({ channel, message });
      // Simulate local delivery
      const handlers = subscribers.get(channel) ?? [];
      for (const h of handlers) h(channel, message);
      return 1;
    }),
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === "message") {
        const channel = "claim:status:changed";
        if (!subscribers.has(channel)) subscribers.set(channel, []);
        subscribers.get(channel)!.push(handler as (channel: string, msg: string) => void);
      }
    }),
    _getPublished: () => publishedMessages,
  };

  return instance;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("EventsController SSE (integration)", () => {
  let app: INestApplication;
  let claimEventsService: ClaimEventsService;
  let registry: SseConnectionRegistry;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              REDIS_URL: "redis://mock:6379",
              SSE_MAX_CONNECTIONS: 10,
            }),
          ],
        }),
        EventsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");

    claimEventsService = moduleRef.get(ClaimEventsService);
    registry = moduleRef.get(SseConnectionRegistry);

    // Mock Redis connections — prevent real network calls in CI
    const mockRedis = createMockRedis();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (claimEventsService as any).subscriber = mockRedis;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (claimEventsService as any).publisher = mockRedis;

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── Connection validation ─────────────────────────────────────────────────

  it("returns 400 when no claimId is provided", async () => {
    const res = await request(app.getHttpServer()).get("/api/events/claims");
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  // ── Registry unit tests ───────────────────────────────────────────────────

  describe("SseConnectionRegistry", () => {
    it("registers and unregisters connections", () => {
      const conn = registry.register("conn-1", ["42", "43"]);
      expect(registry.activeCount()).toBe(1);
      expect(conn.claimIds.has("42")).toBe(true);

      registry.unregister("conn-1");
      expect(registry.activeCount()).toBe(0);
    });

    it("broadcasts only to connections watching the given claimId", () => {
      const conn1 = registry.register("conn-a", ["1"]);
      const conn2 = registry.register("conn-b", ["2"]);

      const received1: object[] = [];
      const received2: object[] = [];

      conn1.subject.subscribe((e) => received1.push(e.data as object));
      conn2.subject.subscribe((e) => received2.push(e.data as object));

      registry.broadcast("1", { claimId: "1", status: "approved" });

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(0); // conn2 watches claimId=2, not 1

      registry.unregister("conn-a");
      registry.unregister("conn-b");
    });

    it("rejects registration when connection limit is reached", () => {
      // Limit is 10 in test config
      for (let i = 0; i < 10; i++) {
        registry.register(`conn-${i}`, ["1"]);
      }

      expect(() => registry.register("conn-overflow", ["1"])).toThrow();

      // Cleanup
      for (let i = 0; i < 10; i++) {
        registry.unregister(`conn-${i}`);
      }
    });

    it("drainAll completes all subjects", (done) => {
      const conn = registry.register("drain-test", ["99"]);
      let completed = false;
      conn.subject.subscribe({
        complete: () => {
          completed = true;
        },
      });

      registry.drainAll();

      setImmediate(() => {
        expect(completed).toBe(true);
        done();
      });
    });
  });

  // ── ClaimEventsService unit tests ─────────────────────────────────────────

  describe("ClaimEventsService", () => {
    it("publish() sends event to Redis channel", async () => {
      const mockRedis = createMockRedis();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (claimEventsService as any).publisher = mockRedis;

      const event: ClaimStatusChangedEvent = {
        claimId: "77",
        status: "approved",
        updatedAt: new Date().toISOString(),
        ledger: 12345,
      };

      await claimEventsService.publish(event);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        "claim:status:changed",
        JSON.stringify(event),
      );
    });

    it("publish() fails silently when Redis is unavailable", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (claimEventsService as any).publisher = {
        publish: jest.fn().mockRejectedValue(new Error("Redis down")),
      };

      const event: ClaimStatusChangedEvent = {
        claimId: "1",
        status: "pending",
        updatedAt: new Date().toISOString(),
      };

      await expect(claimEventsService.publish(event)).resolves.toBeUndefined();
    });

    it("handleMessage broadcasts to matching SSE connections", () => {
      const conn = registry.register("msg-test", ["55"]);
      const received: object[] = [];
      conn.subject.subscribe((e) => received.push(e.data as object));

      const event: ClaimStatusChangedEvent = {
        claimId: "55",
        status: "paid",
        updatedAt: new Date().toISOString(),
      };

      // Trigger internal handler directly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (claimEventsService as any).handleMessage(JSON.stringify(event));

      expect(received).toHaveLength(1);
      expect((received[0] as ClaimStatusChangedEvent).status).toBe("paid");

      registry.unregister("msg-test");
    });

    it("handleMessage ignores malformed JSON without throwing", () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (claimEventsService as any).handleMessage("not-json");
      }).not.toThrow();
    });

    it("handleMessage ignores events missing required fields", () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (claimEventsService as any).handleMessage(JSON.stringify({ claimId: "1" }));
      }).not.toThrow();
    });
  });
});
