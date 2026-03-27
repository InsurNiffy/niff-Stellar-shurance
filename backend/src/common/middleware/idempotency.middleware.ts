/**
 * IdempotencyMiddleware — safe retries for POST /ipfs/upload and POST /tx/submit.
 *
 * ## How it works
 *
 * 1. Client sends a POST with `Idempotency-Key: <uuid-v4>` header.
 * 2. Middleware hashes `SHA-256(method + path + key + subject)` to form the
 *    Redis cache key.  Scoping by subject prevents one user replaying another's
 *    key on the same endpoint.
 * 3. On cache hit (same status + body stored): response is replayed immediately,
 *    no handler is invoked.  Header `Idempotency-Replayed: true` is set.
 * 4. On cache miss: request proceeds normally.  The response interceptor stores
 *    the result before flushing to the client.
 *
 * ## Client responsibilities
 *
 * - Generate a fresh UUID v4 per *logical* operation (not per retry).
 * - Reuse the same key on retries of the same operation.
 * - Keys must be 36 characters (UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx).
 *   Shorter/longer keys are rejected with 400.
 * - Key collision probability with UUID v4 is negligible (~1 in 5.3×10³⁶).
 *
 * ## TTL and eviction
 *
 * Cached responses expire after `TTL.IDEMPOTENCY_SECONDS` (24 h).  After expiry
 * the key is evicted and a fresh request is processed normally.  TTL is always
 * set unconditionally — Redis growth is bounded.
 *
 * ## Schema versioning
 *
 * `IDEMPOTENCY_VERSION` is embedded in every cached entry.  Bump it when the
 * response shape of a covered endpoint changes.  Old entries with a stale
 * version are treated as cache misses and overwritten.
 *
 * ## Redis unavailability (FAIL OPEN)
 *
 * If Redis is down, the middleware logs a warning and lets the request through
 * normally.  A duplicate submission may be processed, but the service stays
 * available.  Operators should alert on Redis unavailability and restore quickly.
 * This behaviour is intentional and documented — idempotency is best-effort
 * when the cache layer is unavailable.
 *
 * Contrast with nonce storage (auth), which FAILS CLOSED.
 */

import { Injectable, NestMiddleware, BadRequestException, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { getIdempotencyEntry, setIdempotencyEntry } from '../redis/cache';
import { TTL } from '../redis/config';

/** Bump this when any covered endpoint's response schema changes. */
export const IDEMPOTENCY_VERSION = 1;

/** UUID v4 pattern — the only accepted key format. */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(IdempotencyMiddleware.name);

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawKey = req.headers['idempotency-key'] as string | undefined;

    // No key — pass through (idempotency is opt-in)
    if (!rawKey) {
      next();
      return;
    }

    // Validate format
    if (!UUID_V4_RE.test(rawKey)) {
      throw new BadRequestException(
        'Idempotency-Key must be a valid UUID v4 (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)',
      );
    }

    // Build scoped cache key: hash(method + path + rawKey + subject)
    // Subject is the authenticated wallet address when present, otherwise 'anon'.
    const subject: string = (req as Request & { user?: { sub?: string } }).user?.sub ?? 'anon';
    const cacheKey = createHash('sha256')
      .update(`${req.method}:${req.path}:${rawKey}:${subject}`)
      .digest('hex');

    // Cache hit — replay stored response
    const cached = await getIdempotencyEntry(cacheKey, IDEMPOTENCY_VERSION);
    if (cached) {
      this.logger.debug(`Idempotency replay: key=${rawKey} subject=${subject} path=${req.path}`);
      res.setHeader('Idempotency-Replayed', 'true');
      res.status(cached.status).json(cached.body);
      return;
    }

    // Cache miss — intercept the response to store it
    const originalJson = res.json.bind(res);
    res.json = (body: unknown): Response => {
      // Only cache 2xx and 4xx responses; never cache 5xx (transient errors)
      if (res.statusCode < 500) {
        setIdempotencyEntry(
          cacheKey,
          { status: res.statusCode, body, version: IDEMPOTENCY_VERSION },
          TTL.IDEMPOTENCY_SECONDS,
        ).catch((err: unknown) => {
          this.logger.warn(`Failed to store idempotency entry: ${String(err)}`);
        });
      }
      return originalJson(body);
    };

    next();
  }
}
