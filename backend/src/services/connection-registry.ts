import type { Response } from 'express';

/**
 * Connection registry for the SSE event stream (`GET /v1/events/stream`).
 *
 * Tracks live SSE connections per user, enforces a per-user connection cap,
 * and drives heartbeats so proxies don't drop idle streams. Cleanup runs on
 * disconnect so a user's slot is released immediately.
 */

export interface SseConnection {
  id: string;
  userId: string;
  res: Response;
  /** Claim ids the caller subscribed to. */
  claimIds: Set<string>;
  /** Whether the caller subscribed to their own address events. */
  ownAddress: boolean;
  /** Last event id delivered, used for `Last-Event-ID` resume. */
  lastEventId: string | null;
  createdAt: number;
  heartbeat: NodeJS.Timeout;
}

export interface ConnectionRegistryOptions {
  /** Maximum concurrent SSE connections allowed per user. */
  maxConnectionsPerUser?: number;
  /** Heartbeat interval in milliseconds. */
  heartbeatIntervalMs?: number;
}

const DEFAULT_MAX_CONNECTIONS_PER_USER = 5;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

let connectionSeq = 0;

function nextConnectionId(): string {
  connectionSeq += 1;
  return `sse_${Date.now().toString(36)}_${connectionSeq.toString(36)}`;
}

export class ConnectionRegistry {
  private readonly byId = new Map<string, SseConnection>();
  private readonly byUser = new Map<string, Set<string>>();
  private readonly maxConnectionsPerUser: number;
  private readonly heartbeatIntervalMs: number;

  constructor(options: ConnectionRegistryOptions = {}) {
    this.maxConnectionsPerUser =
      options.maxConnectionsPerUser ?? DEFAULT_MAX_CONNECTIONS_PER_USER;
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  }

  /** Number of live connections for a user. */
  countForUser(userId: string): number {
    return this.byUser.get(userId)?.size ?? 0;
  }

  /** Total number of live connections across all users. */
  size(): number {
    return this.byId.size;
  }

  /**
   * Register a new SSE connection. Returns `null` when the per-user cap is
   * already reached, so the caller can reject with 429.
   */
  register(params: {
    userId: string;
    res: Response;
    claimIds?: Iterable<string>;
    ownAddress?: boolean;
    lastEventId?: string | null;
  }): SseConnection | null {
    const { userId, res } = params;

    if (this.countForUser(userId) >= this.maxConnectionsPerUser) {
      return null;
    }

    const connection: SseConnection = {
      id: nextConnectionId(),
      userId,
      res,
      claimIds: new Set(params.claimIds ?? []),
      ownAddress: params.ownAddress ?? false,
      lastEventId: params.lastEventId ?? null,
      createdAt: Date.now(),
      heartbeat: setInterval(() => this.heartbeat(connection.id), this.heartbeatIntervalMs),
    };

    // Don't keep the process alive solely for heartbeats.
    if (typeof connection.heartbeat.unref === 'function') {
      connection.heartbeat.unref();
    }

    this.byId.set(connection.id, connection);
    let userConnections = this.byUser.get(userId);
    if (!userConnections) {
      userConnections = new Set();
      this.byUser.set(userId, userConnections);
    }
    userConnections.add(connection.id);

    return connection;
  }

  /** Look up a live connection by id. */
  get(connectionId: string): SseConnection | undefined {
    return this.byId.get(connectionId);
  }

  /** All live connections for a user. */
  forUser(userId: string): SseConnection[] {
    const ids = this.byUser.get(userId);
    if (!ids) return [];
    const connections: SseConnection[] = [];
    for (const id of ids) {
      const connection = this.byId.get(id);
      if (connection) connections.push(connection);
    }
    return connections;
  }

  /**
   * Remove a connection and release its user slot. Safe to call multiple
   * times (e.g. from both the `close` handler and shutdown).
   */
  unregister(connectionId: string): void {
    const connection = this.byId.get(connectionId);
    if (!connection) return;

    clearInterval(connection.heartbeat);
    this.byId.delete(connectionId);

    const userConnections = this.byUser.get(connection.userId);
    if (userConnections) {
      userConnections.delete(connectionId);
      if (userConnections.size === 0) {
        this.byUser.delete(connection.userId);
      }
    }
  }

  /** Send a heartbeat comment to keep the stream alive. */
  private heartbeat(connectionId: string): void {
    const connection = this.byId.get(connectionId);
    if (!connection) return;
    try {
      connection.res.write(': heartbeat\n\n');
    } catch {
      this.unregister(connectionId);
    }
  }

  /** Close every connection, e.g. during graceful shutdown. */
  closeAll(): void {
    for (const connectionId of Array.from(this.byId.keys())) {
      const connection = this.byId.get(connectionId);
      this.unregister(connectionId);
      try {
        connection?.res.end();
      } catch {
        // ignore errors while shutting down
      }
    }
  }
}

export const connectionRegistry = new ConnectionRegistry();
