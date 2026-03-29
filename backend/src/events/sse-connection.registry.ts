/**
 * SSE Connection Registry
 *
 * Tracks all active SSE connections for graceful shutdown and monitoring.
 *
 * Max concurrent connections: controlled by MAX_SSE_CONNECTIONS (default 500).
 * When the limit is reached, new connections receive 503 until existing ones
 * close. This prevents unbounded memory growth under load.
 *
 * Backpressure behavior:
 *   Each connection holds one Subject in memory. Under high event throughput,
 *   RxJS subjects are synchronous — events are delivered inline without
 *   buffering. If a slow client causes write backpressure on the underlying
 *   TCP socket, Node's stream will buffer up to the socket's highWaterMark
 *   (~16 KB) before the write call blocks. At that point the SSE response's
 *   `.write()` call returns false and Node will pause accepting new data on
 *   that socket. The connection is not forcibly closed; it will self-heal
 *   when the client reads the buffer. Operators should monitor the
 *   `sse_active_connections` gauge and set nginx `proxy_read_timeout` to
 *   at least 65 s to accommodate 25 s heartbeat intervals with margin.
 *
 * Graceful shutdown:
 *   On SIGTERM, `drainAll()` completes every active Subject, which causes
 *   the SSE stream to send a final `event: close\ndata: shutdown\n\n` before
 *   the TCP connection is torn down. The NestJS shutdown hook calls this
 *   before the HTTP server stops accepting new connections, giving in-flight
 *   event deliveries a chance to flush.
 */

import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Subject } from "rxjs";

export interface SseConnection {
  id: string;
  subject: Subject<MessageEvent>;
  claimIds: Set<string>;
  createdAt: number;
  walletAddress?: string;
}

@Injectable()
export class SseConnectionRegistry {
  private readonly logger = new Logger(SseConnectionRegistry.name);
  private readonly connections = new Map<string, SseConnection>();
  private readonly maxConnections: number;

  constructor(private readonly config: ConfigService) {
    this.maxConnections = this.config.get<number>("SSE_MAX_CONNECTIONS", 500);
  }

  register(id: string, claimIds: string[], walletAddress?: string): SseConnection {
    if (this.connections.size >= this.maxConnections) {
      throw new ServiceUnavailableException(
        `SSE connection limit reached (${this.maxConnections}). Try again later.`,
      );
    }

    const connection: SseConnection = {
      id,
      subject: new Subject<MessageEvent>(),
      claimIds: new Set(claimIds),
      createdAt: Date.now(),
      walletAddress,
    };

    this.connections.set(id, connection);
    this.logger.debug(
      `SSE connection registered: ${id} (watching ${claimIds.length} claims, total: ${this.connections.size})`,
    );

    return connection;
  }

  unregister(id: string): void {
    const conn = this.connections.get(id);
    if (conn) {
      conn.subject.complete();
      this.connections.delete(id);
      this.logger.debug(`SSE connection closed: ${id} (total: ${this.connections.size})`);
    }
  }

  get(id: string): SseConnection | undefined {
    return this.connections.get(id);
  }

  getAll(): SseConnection[] {
    return Array.from(this.connections.values());
  }

  activeCount(): number {
    return this.connections.size;
  }

  /**
   * Deliver an event to all connections watching the given claim ID.
   * Called by ClaimEventsService on every Redis pub/sub message.
   */
  broadcast(claimId: string, payload: object): void {
    const event = { data: payload } as MessageEvent;
    let delivered = 0;

    for (const conn of this.connections.values()) {
      if (conn.claimIds.has(claimId)) {
        conn.subject.next(event);
        delivered++;
      }
    }

    if (delivered > 0) {
      this.logger.debug(
        `Broadcasted claimId=${claimId} to ${delivered} SSE connection(s)`,
      );
    }
  }

  /**
   * Graceful shutdown: complete all active subjects so streams end cleanly.
   * NestJS lifecycle hook calls this before HTTP server closes.
   */
  drainAll(): void {
    this.logger.log(`Draining ${this.connections.size} active SSE connections...`);
    for (const conn of this.connections.values()) {
      try {
        // Signal shutdown to the client before the TCP connection closes
        conn.subject.next({
          data: { event: "close", reason: "server_shutdown" },
        } as MessageEvent);
        conn.subject.complete();
      } catch {
        // Ignore — connection may already be gone
      }
    }
    this.connections.clear();
  }
}
