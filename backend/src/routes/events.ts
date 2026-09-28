import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { createClient, RedisClientType } from 'redis';
import { authenticate } from '../middleware/auth';

/**
 * Server-Sent Events stream for live claim and transaction updates.
 *
 * Endpoint: GET /v1/events/stream
 *
 * Authentication:
 *   EventSource cannot set request headers, so the stream is authenticated with a
 *   short-lived stream token passed as a query parameter (`?token=...`). The token is
 *   issued by a normal authenticated endpoint (POST /v1/events/token) and is scoped to
 *   the caller's subscriptions (claim ids + own address).
 *
 * Fan-out:
 *   Events are published to Redis pub/sub so that a client connected to one instance
 *   receives events published on any other instance.
 *
 * Resume:
 *   A short Redis stream buffer keeps recent events so a reconnecting client can resume
 *   from `Last-Event-ID`.
 *
 * Event payload schema (versioned):
 *   {
 *     "v": 1,
 *     "id": "<stream id>",
 *     "type": "claim.vote" | "claim.updated" | "transaction.confirmed" | "transaction.failed",
 *     "claimId": "<claim id>",
 *     "address": "<address>",
 *     "data": { ... },
 *     "ts": 1700000000000
 *   }
 */

const STREAM_TOKEN_TTL_SECONDS = 60;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_CONNECTIONS_PER_USER = 5;
const STREAM_BUFFER_MAX_LEN = 500;
const STREAM_BUFFER_TTL_SECONDS = 300;

const EVENTS_CHANNEL = 'events:fanout';
const EVENTS_STREAM_KEY = 'events:stream';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

interface StreamTokenPayload {
  sub: string;
  address: string;
  claimIds: string[];
  scope: 'events:stream';
}

interface EventPayload {
  v: number;
  id?: string;
  type: string;
  claimId?: string;
  address?: string;
  data?: unknown;
  ts: number;
}

interface Connection {
  userId: string;
  address: string;
  claimIds: Set<string>;
  res: Response;
  heartbeat: NodeJS.Timeout;
}

/**
 * Connection registry with a per-user connection cap and cleanup on disconnect.
 */
class ConnectionRegistry {
  private byUser = new Map<string, Set<Connection>>();

  add(conn: Connection): boolean {
    const set = this.byUser.get(conn.userId) ?? new Set<Connection>();
    if (set.size >= MAX_CONNECTIONS_PER_USER) {
      return false;
    }
    set.add(conn);
    this.byUser.set(conn.userId, set);
    return true;
  }

  remove(conn: Connection): void {
    const set = this.byUser.get(conn.userId);
    if (!set) return;
    set.delete(conn);
    if (set.size === 0) {
      this.byUser.delete(conn.userId);
    }
  }

  /**
   * Deliver an event to every local connection whose subscriptions match.
   */
  dispatch(event: EventPayload): void {
    for (const set of this.byUser.values()) {
      for (const conn of set) {
        if (!matches(conn, event)) continue;
        writeEvent(conn.res, event);
      }
    }
  }
}

function matches(conn: Connection, event: EventPayload): boolean {
  if (event.claimId && conn.claimIds.has(event.claimId)) return true;
  if (event.address && event.address.toLowerCase() === conn.address.toLowerCase()) return true;
  return false;
}

function writeEvent(res: Response, event: EventPayload): void {
  if (event.id) res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

const registry = new ConnectionRegistry();

let publisher: RedisClientType | null = null;
let subscriber: RedisClientType | null = null;

async function getPublisher(): Promise<RedisClientType> {
  if (!publisher) {
    publisher = createClient({ url: process.env.REDIS_URL });
    publisher.on('error', (err) => console.error('[events] redis publisher error', err));
    await publisher.connect();
  }
  return publisher;
}

async function getSubscriber(): Promise<RedisClientType> {
  if (!subscriber) {
    subscriber = createClient({ url: process.env.REDIS_URL });
    subscriber.on('error', (err) => console.error('[events] redis subscriber error', err));
    await subscriber.connect();
    await subscriber.subscribe(EVENTS_CHANNEL, (message) => {
      try {
        const event = JSON.parse(message) as EventPayload;
        registry.dispatch(event);
      } catch (err) {
        console.error('[events] failed to parse fanout message', err);
      }
    });
  }
  return subscriber;
}

/**
 * Publish an event: append to the short Redis stream buffer (for resume) and fan out
 * across instances via pub/sub.
 */
export async function publishEvent(event: Omit<EventPayload, 'v' | 'id' | 'ts'> & Partial<EventPayload>): Promise<void> {
  const payload: EventPayload = {
    v: 1,
    ts: Date.now(),
    ...event,
  };
  const client = await getPublisher();
  const id = await client.xAdd(EVENTS_STREAM_KEY, { payload: JSON.stringify(payload) }, {
    TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: STREAM_BUFFER_MAX_LEN },
  });
  payload.id = id;
  await client.expire(EVENTS_STREAM_KEY, STREAM_BUFFER_TTL_SECONDS);
  await client.publish(EVENTS_CHANNEL, JSON.stringify(payload));
}

/**
 * Replay buffered events after `lastEventId` so a reconnecting client can resume.
 */
async function replayFrom(lastEventId: string, conn: Connection): Promise<void> {
  const client = await getPublisher();
  const entries = await client.xRange(EVENTS_STREAM_KEY, `(${lastEventId}`, '+');
  for (const entry of entries) {
    try {
      const event = JSON.parse(entry.message.payload) as EventPayload;
      event.id = entry.id;
      if (matches(conn, event)) writeEvent(conn.res, event);
    } catch (err) {
      console.error('[events] failed to replay buffered event', err);
    }
  }
}

const router = Router();

/**
 * Issue a short-lived stream token for the authenticated caller.
 */
router.post('/token', authenticate, (req: Request, res: Response) => {
  const user = (req as Request & { user?: { id: string; address: string; claimIds?: string[] } }).user;
  if (!user) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const payload: StreamTokenPayload = {
    sub: user.id,
    address: user.address,
    claimIds: user.claimIds ?? [],
    scope: 'events:stream',
  };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: STREAM_TOKEN_TTL_SECONDS });
  return res.json({ token, expiresIn: STREAM_TOKEN_TTL_SECONDS });
});

/**
 * SSE stream. Authenticated via short-lived stream token in the query string.
 */
router.get('/stream', async (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : undefined;
  if (!token) {
    return res.status(401).json({ error: 'missing token' });
  }

  let payload: StreamTokenPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as StreamTokenPayload;
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
  if (payload.scope !== 'events:stream') {
    return res.status(403).json({ error: 'invalid scope' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const conn: Connection = {
    userId: payload.sub,
    address: payload.address,
    claimIds: new Set(payload.claimIds ?? []),
    res,
    heartbeat: setInterval(() => {
      res.write(': heartbeat\n\n');
    }, HEARTBEAT_INTERVAL_MS),
  };

  if (!registry.add(conn)) {
    clearInterval(conn.heartbeat);
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'connection limit reached' })}\n\n`);
    return res.end();
  }

  // Ensure this instance is subscribed to the fan-out channel.
  await getSubscriber();

  const lastEventId = req.headers['last-event-id'];
  if (typeof lastEventId === 'string' && lastEventId.length > 0) {
    try {
      await replayFrom(lastEventId, conn);
    } catch (err) {
      console.error('[events] resume failed', err);
    }
  }

  const cleanup = () => {
    clearInterval(conn.heartbeat);
    registry.remove(conn);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
});

export default router;
