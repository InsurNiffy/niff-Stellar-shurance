import express, { Request, Response, NextFunction } from 'express';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createClient, RedisClientType } from 'redis';
import policiesRouter from './routes/policies';
import claimsRouter from './routes/claims';
import authRouter from './routes/auth';

const app = express();

// Explicit origin allowlist sourced from env (comma-separated).
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Strict CSP: only necessary sources (Stellar SDK CDN, IPFS gateways).
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: [
    "'self'",
    'https://cdn.jsdelivr.net',
    'https://unpkg.com',
  ],
  styleSrc: ["'self'", 'https://cdn.jsdelivr.net'],
  imgSrc: [
    "'self'",
    'data:',
    'https://ipfs.io',
    'https://gateway.pinata.cloud',
    'https://cloudflare-ipfs.com',
  ],
  connectSrc: [
    "'self'",
    'https://horizon.stellar.org',
    'https://horizon-testnet.stellar.org',
    'https://ipfs.io',
    'https://gateway.pinata.cloud',
    'https://cloudflare-ipfs.com',
  ],
  fontSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  frameAncestors: ["'none'"],
  formAction: ["'self'"],
  upgradeInsecureRequests: [],
};

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: cspDirectives,
    },
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  })
);

// Referrer-Policy, Permissions-Policy, and X-Content-Type-Options headers.
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// CORS with explicit origin allowlist; reject pre-flight from unlisted origins.
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    optionsSuccessStatus: 204,
  })
);

app.use(express.json());

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let redisClient: RedisClientType | null = null;

async function getRedisClient(): Promise<RedisClientType> {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('Redis client error', err);
    });
    await redisClient.connect();
  }
  return redisClient;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

interface CachedResponse {
  bodyHash: string;
  status: number;
  body: unknown;
}

/**
 * Idempotency middleware: deduplicates state-mutating POST requests by the
 * `Idempotency-Key` header. Cached responses are stored in Redis for 24h.
 * Replaying the same key with a different request body returns 422.
 */
export function IdempotencyMiddleware() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = req.header('Idempotency-Key');
    if (!key) {
      next();
      return;
    }
    if (!UUID_REGEX.test(key)) {
      res.status(400).json({ error: 'Idempotency-Key must be a valid UUID' });
      return;
    }

    const bodyHash = stableStringify(req.body ?? {});
    const cacheKey = `idempotency:${key}`;

    let client: RedisClientType;
    try {
      client = await getRedisClient();
    } catch (err) {
      next(err);
      return;
    }

    let cached: string | null = null;
    try {
      cached = await client.get(cacheKey);
    } catch (err) {
      next(err);
      return;
    }

    if (cached) {
      const parsed = JSON.parse(cached) as CachedResponse;
      if (parsed.bodyHash !== bodyHash) {
        res.status(422).json({
          error: 'Idempotency-Key already used with a different request body',
        });
        return;
      }
      res.status(parsed.status).json(parsed.body);
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const status = res.statusCode;
      if (status >= 200 && status < 300) {
        const payload: CachedResponse = { bodyHash, status, body };
        client
          .set(cacheKey, JSON.stringify(payload), { EX: IDEMPOTENCY_TTL_SECONDS })
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.error('Failed to cache idempotent response', err);
          });
      }
      return originalJson(body);
    };

    next();
  };
}

const idempotency = IdempotencyMiddleware();

app.use('/policies/build-transaction', idempotency);
app.use('/claims/build-transaction', idempotency);
app.use('/auth/verify', idempotency);

app.use('/policies', policiesRouter);
app.use('/claims', claimsRouter);
app.use('/auth', authRouter);

export default app;
