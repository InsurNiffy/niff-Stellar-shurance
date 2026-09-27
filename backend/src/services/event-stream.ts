import type { Request, Response } from "express";
import { createClient, type RedisClientType } from "redis";
import { verify } from "jsonwebtoken";

/**
 * Server-Sent Events stream for live claim and transaction updates.
 *
 * Endpoint: GET /v1/events/stream
 *
 * Authentication: EventSource cannot set headers, so the caller first obtains a
 * short-lived stream token from a normal authenticated endpoint and passes it as
 * the `token` query parameter. The token is a JWT signed with STREAM_TOKEN_SECRET
 * and carries `{ sub: address, scope: "events:stream" }`.
 *
 * Fan-out: events are published to a Redis pub/sub channel so every backend
 * instance receives them regardless of which instance handled the write.
 *
 * Resume: the last N events are kept in a short Redis stream buffer. A client
 * reconnecting with `Last-Event-ID` receives buffered events after that id.
 */

// ---------------------------------------------------------------------------
// Event payload schema (typed, versioned)
// ---------------------------------------------------------------------------

export const EVENT_SCHEMA_VERSION = 1 as const;

export type EventType =
  | "claim.vote"
  | "claim.status"
  | "transaction.confirmed"
  | "transaction.failed";

export interface StreamEvent<T = Record<string, unknown>> {
  /** Monotonic event id, used for SSE `id:` and Last-Event-ID resume. */
  id: string;
  /** Schema version for forward-compatible consumers. */
  v: typeof EVENT_SCHEMA_VERSION;
  type: EventType;
  /** Unix epoch milliseconds. */
  ts: number;
  /** Claim ids this event concerns (used for subscription filtering). */
  claimIds: string[];
  /** Addresses this event concerns (used for subscription filtering). */
  addresses: string[];
  data: T;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const HEARTBEAT_MS = 15_000;
const MAX_CONNECTIONS_PER_USER = 5;
const STREAM_BUFFER_MAX = 500;
const STREAM_BUFFER_TTL_SECONDS = 300;

const CHANNEL = "events:stream";
const BUFFER_KEY = "events:stream:buffer";

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required env var ${name}`);
  return value;
}

// ---------------------------------------------------------------------------
// Redis clients (pub/sub requires dedicated subscriber connection)
// ---------------------------------------------------------------------------

let publisher: RedisClientType | null = null;
let subscriber: RedisClientType | null = null;

function getPublisher(): RedisClientType {
  if (!publisher) {
    publisher = createClient({ url: env("REDIS_URL", "redis://localhost:6379") });
    publisher.on("error", (err) => console.error("[events] publisher error", err));
    void publisher.connect();
  }
  return publisher;
}

function getSubscriber(): RedisClientType {
  if (!subscriber) {
    subscriber = createClient({ url: env("REDIS_URL", "redis://localhost:6379") });
    subscriber.on("error", (err) => console.error("[events] subscriber error", err));
    void subscriber.connect();
  }
  return subscriber;
}

// ---------------------------------------------------------------------------
// Connection registry with per-user cap
// ---------------------------------------------------------------------------

interface Connection {
  id: string;
  address: string;
  claimIds: Set<string>;
  res: Response;
  heartbeat: NodeJS.Timeout;
}

const connections = new Map<string, Connection>();
const byUser = new Map<string, Set<string>>();

function registerConnection(conn: Connection): boolean {
  const userConns = byUser.get(conn.address) ?? new Set<string>();
  if (userConns.size >= MAX_CONNECTIONS_PER_USER) return false;
  userConns.add(conn.id);
  byUser.set(conn.address, userConns);
  connections.set(conn.id, conn);
  return true;
}

function removeConnection(id: string): void {
  const conn = connections.get(id);
  if (!conn) return;
  clearInterval(conn.heartbeat);
  connections.delete(id);
  const userConns = byUser.get(conn.address);
  if (userConns) {
    userConns.delete(id);
    if (userConns.size === 0) byUser.delete(conn.address);
  }
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function matches(conn: Connection, event: StreamEvent): boolean {
  if (event.addresses.includes(conn.address)) return true;
  return event.claimIds.some((id) => conn.claimIds.has(id));
}

function writeEvent(res: Response, event: StreamEvent): void {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

// ---------------------------------------------------------------------------
// Publish / subscribe
// ---------------------------------------------------------------------------

/** Publish an event to all instances. Also appends to the resume buffer. */
export async function publishEvent(
  event: Omit<StreamEvent, "id" | "v" | "ts"> & Partial<Pick<StreamEvent, "id" | "ts">>,
): Promise<StreamEvent> {
  const full: StreamEvent = {
    id: event.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    v: EVENT_SCHEMA_VERSION,
    ts: event.ts ?? Date.now(),
    type: event.type,
    claimIds: event.claimIds,
    addresses: event.addresses,
    data: event.data,
  };
  const redis = getPublisher();
  await redis.xAdd(BUFFER_KEY, "*", { payload: JSON.stringify(full) }, {
    TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: STREAM_BUFFER_MAX },
  });
  await redis.publish(CHANNEL, JSON.stringify(full));
  return full;
}

let subscribed = false;

async function ensureSubscribed(): Promise<void> {
  if (subscribed) return;
  subscribed = true;
  const sub = getSubscriber();
  await sub.subscribe(CHANNEL, (message) => {
    let event: StreamEvent;
    try {
      event = JSON.parse(message) as StreamEvent;
    } catch {
      return;
    }
    for (const conn of connections.values()) {
      if (matches(conn, event)) writeEvent(conn.res, event);
    }
  });
}

// ---------------------------------------------------------------------------
// Resume from buffer
// ---------------------------------------------------------------------------

async function replayFromBuffer(res: Response, conn: Connection, lastEventId: string): Promise<void> {
  const redis = getPublisher();
  const entries = await redis.xRange(BUFFER_KEY, "-", "+");
  let found = false;
  for (const entry of entries) {
    const payload = entry.message.payload;
    if (!payload) continue;
    let event: StreamEvent;
    try {
      event = JSON.parse(payload) as StreamEvent;
    } catch {
      continue;
    }
    if (!found) {
      if (event.id === lastEventId) found = true;
      continue;
    }
    if (matches(conn, event)) writeEvent(res, event);
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

interface StreamTokenPayload {
  sub: string;
  scope: string;
}

function authenticate(req: Request): StreamTokenPayload | null {
  const token = typeof req.query.token === "string" ? req.query.token : undefined;
  if (!token) return null;
  try {
    const payload = verify(token, env("STREAM_TOKEN_SECRET")) as StreamTokenPayload;
    if (payload.scope !== "events:stream" || !payload.sub) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function eventsStreamHandler(req: Request, res: Response): Promise<void> {
  const auth = authenticate(req);
  if (!auth) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const claimIds = new Set<string>();
  const rawClaims = req.query.claimIds;
  if (typeof rawClaims === "string") {
    for (const id of rawClaims.split(",")) if (id.trim()) claimIds.add(id.trim());
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  const conn: Connection = {
    id: `${auth.sub}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    address: auth.sub,
    claimIds,
    res,
    heartbeat: setInterval(() => res.write(": heartbeat\n\n"), HEARTBEAT_MS),
  };

  if (!registerConnection(conn)) {
    clearInterval(conn.heartbeat);
    res.write(`event: error\ndata: ${JSON.stringify({ error: "connection_limit" })}\n\n`);
    res.end();
    return;
  }

  await ensureSubscribed();

  const lastEventId = req.headers["last-event-id"];
  if (typeof lastEventId === "string" && lastEventId) {
    try {
      await replayFromBuffer(res, conn, lastEventId);
    } catch (err) {
      console.error("[events] resume failed", err);
    }
  }

  req.on("close", () => removeConnection(conn.id));
}

export const __testing = {
  MAX_CONNECTIONS_PER_USER,
  HEARTBEAT_MS,
  connections,
  byUser,
  registerConnection,
  removeConnection,
};
