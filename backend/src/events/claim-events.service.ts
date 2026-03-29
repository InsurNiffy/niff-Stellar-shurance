/**
 * ClaimEventsService
 *
 * Bridges the Redis pub/sub channel `claim:status:changed` to active SSE
 * connections via the SseConnectionRegistry.
 *
 * Internal bus design:
 *   The indexer's handleClaimFiled / handleClaimProcessed / handleVoteCast
 *   methods call ClaimEventsService.publish() after each Prisma upsert. This
 *   keeps the SSE bus decoupled from the Prisma transaction — the transaction
 *   commits first, then the event is published. No DB transaction is held open
 *   during SSE delivery.
 *
 *   In a multi-instance deployment, each backend instance subscribes to the
 *   same Redis channel. When any instance calls publish(), all instances
 *   receive the message and broadcast to their local SSE connections. This
 *   ensures horizontal scale without a centralised fan-out process.
 *
 * Redis channel: `claim:status:changed`
 * Message format: JSON { claimId: string; status: string; updatedAt: string; ledger?: number }
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { ConfigService } from "@nestjs/config";
import { SseConnectionRegistry } from "./sse-connection.registry";

export interface ClaimStatusChangedEvent {
  claimId: string;
  status: string;
  updatedAt: string;
  ledger?: number;
}

const REDIS_CHANNEL = "claim:status:changed";

@Injectable()
export class ClaimEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClaimEventsService.name);
  private subscriber: Redis | null = null;
  private publisher: Redis | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SseConnectionRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>("REDIS_URL", "redis://localhost:6379");

    // Dedicated subscriber connection — subscribe() blocks the connection for
    // pub/sub mode, so it cannot be shared with the general RedisService client.
    this.subscriber = new Redis(redisUrl, {
      lazyConnect: true,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 3000)),
    });

    // Dedicated publisher connection
    this.publisher = new Redis(redisUrl, {
      lazyConnect: true,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 3000)),
    });

    this.subscriber.on("error", (err) =>
      this.logger.warn(`SSE Redis subscriber error: ${err.message}`),
    );
    this.publisher.on("error", (err) =>
      this.logger.warn(`SSE Redis publisher error: ${err.message}`),
    );

    try {
      await this.subscriber.connect();
      await this.publisher.connect();
      await this.subscriber.subscribe(REDIS_CHANNEL);
      this.logger.log(`Subscribed to Redis channel: ${REDIS_CHANNEL}`);

      this.subscriber.on("message", (_channel: string, message: string) => {
        this.handleMessage(message);
      });
    } catch (err) {
      // Non-fatal at startup: SSE will not push events but the rest of the
      // application remains functional. Log a clear warning so operators notice.
      this.logger.warn(
        `ClaimEventsService: Redis unavailable at startup. SSE push disabled. Error: ${err}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.registry.drainAll();
    try {
      await this.subscriber?.unsubscribe(REDIS_CHANNEL);
      await this.subscriber?.quit();
      await this.publisher?.quit();
    } catch {
      // Ignore shutdown errors
    }
  }

  /**
   * Publish a claim status change to the Redis channel.
   * Call this from the indexer after a successful Prisma upsert.
   * The Prisma transaction must be committed before calling this method.
   */
  async publish(event: ClaimStatusChangedEvent): Promise<void> {
    if (!this.publisher) return;

    try {
      await this.publisher.publish(REDIS_CHANNEL, JSON.stringify(event));
    } catch (err) {
      // Fail silently — pub/sub failure does not affect data integrity
      this.logger.warn(`Failed to publish claim event: ${err}`);
    }
  }

  private handleMessage(message: string): void {
    let event: ClaimStatusChangedEvent;

    try {
      event = JSON.parse(message) as ClaimStatusChangedEvent;
    } catch {
      this.logger.warn(`Received malformed message on ${REDIS_CHANNEL}: ${message}`);
      return;
    }

    if (!event.claimId || !event.status) {
      this.logger.warn(`Ignoring incomplete claim event: ${message}`);
      return;
    }

    this.registry.broadcast(event.claimId, event);
  }
}
