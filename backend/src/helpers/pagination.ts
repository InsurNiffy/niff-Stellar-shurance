/**
 * Cursor-based pagination utilities shared across all list endpoints.
 *
 * ## Cursor strategy
 * Each cursor encodes `{ createdAt: ISO-8601, id: number }` — the stable sort
 * key of the last item on the current page — as base64url JSON, optionally
 * signed with an HMAC-SHA256 tag to detect tampering.
 *
 * Ordering: `ORDER BY created_at DESC, id DESC` (newest-first).
 * Tie-breaker on `id` guarantees a total order even when two rows share the
 * same `created_at` timestamp (e.g. bulk inserts).
 *
 * ## Consistency semantics (document for clients)
 * Cursors are point-in-time snapshots of `(createdAt, id)`.
 *
 * - **Inserts after cursor creation**: rows inserted with a `createdAt` newer
 *   than the first page will NOT appear on subsequent pages — they would have
 *   appeared on page 1. This is expected for append-heavy workloads.
 * - **Inserts before cursor position**: rows inserted with a `createdAt` older
 *   than the cursor may appear on a later page. Clients building infinite-scroll
 *   UIs should deduplicate by `id`.
 * - **Deletes**: the next page simply skips the gap; no error is raised.
 * - **Updates to sort keys**: if `createdAt` is updated (rare), the row may
 *   appear twice or be skipped. `createdAt` is treated as immutable.
 *
 * ## Time drift
 * Cursors encode the `createdAt` value stored in the database at the time the
 * page was fetched. If the database clock drifts relative to the application
 * server, cursor values remain internally consistent because they are always
 * compared against other database-stored timestamps — not wall-clock time.
 *
 * ## Infinite-scroll guidance
 * ```
 * let cursor: string | null = null;
 * do {
 *   const page = await fetch(`/api/claims?limit=20&after=${cursor ?? ''}`);
 *   const { data, next_cursor } = await page.json();
 *   appendToList(data);
 *   cursor = next_cursor;
 * } while (cursor !== null);
 * ```
 *
 * ## OFFSET avoidance
 * No OFFSET is used. The WHERE clause filters rows using the cursor values
 * directly, so query cost is O(index scan from cursor position) regardless
 * of how many pages have already been fetched.
 */

import { createHmac } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { getRuntimeEnv } from '../config/runtime-env';

export class CursorError extends BadRequestException {
  constructor(message: string) {
    super(message);
    this.name = 'CursorError';
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/**
 * Set PAGINATION_HMAC_SECRET in your environment to enable cursor signing.
 * If absent, cursors are still base64url-encoded but not signed.
 * Signing prevents clients from crafting arbitrary cursors to probe the DB.
 */
const HMAC_SECRET = getRuntimeEnv().PAGINATION_HMAC_SECRET;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PageParams {
  /** Opaque cursor from a previous response's `next_cursor`. */
  after?: string;
  /**
   * Maximum items per page.
   * Values above MAX_LIMIT (100) are clamped — never rejected — per the
   * published clamping policy. Values below 1 are clamped to 1.
   */
  limit?: number;
}

export interface CursorPayload {
  /** ISO-8601 timestamp of the last item's `createdAt`. */
  createdAt: string;
  /** Numeric `id` of the last item (tie-breaker). */
  id: number;
}

export interface CursorPageResult<T> {
  data: T[];
  /**
   * Opaque cursor to pass as `after` for the next page.
   * `null` when this is the last page.
   */
  next_cursor: string | null;
  /**
   * Total rows matching the filter (before pagination).
   * Clients may use this for progress indicators.
   *
   * NOTE: this count is eventually consistent — a concurrent insert between
   * the count query and the data query may cause `total` to be off by one.
   */
  total: number;
}

/**
 * Prisma-compatible keyset WHERE clause for the next page.
 * Use with `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`.
 */
export interface KeysetWhere {
  OR: [
    { createdAt: { lt: Date } },
    { createdAt: { equals: Date }; id: { lt: number } },
  ];
}

// ---------------------------------------------------------------------------
// Limit helpers
// ---------------------------------------------------------------------------

/**
 * Clamps the requested limit to [1, MAX_LIMIT].
 * Oversized values are silently clamped per the published policy.
 */
export function clampLimit(requested: number | undefined): number {
  return Math.min(Math.max(1, requested ?? DEFAULT_LIMIT), MAX_LIMIT);
}

// ---------------------------------------------------------------------------
// Cursor encode / decode
// ---------------------------------------------------------------------------

function sign(payload: string): string {
  if (!HMAC_SECRET) return '';
  return createHmac('sha256', HMAC_SECRET).update(payload).digest('base64url');
}

/**
 * Encodes a `(createdAt, id)` pair into an opaque base64url cursor string.
 * If `PAGINATION_HMAC_SECRET` is set, appends an HMAC tag for integrity.
 */
export function encodeCursor(createdAt: Date, id: number): string {
  const payload: CursorPayload = { createdAt: createdAt.toISOString(), id };
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, 'utf8').toString('base64url');
  const tag = sign(encoded);
  return tag ? `${encoded}.${tag}` : encoded;
}

/**
 * Decodes a cursor string back to a `CursorPayload`.
 * Throws `BadRequestException` (HTTP 400) on any invalid input so controllers
 * do not need to handle the error themselves.
 */
export function decodeCursor(cursor: string): CursorPayload {
  try {
    let encoded = cursor;

    if (HMAC_SECRET) {
      const dotIndex = cursor.lastIndexOf('.');
      if (dotIndex === -1) {
        throw new Error('missing signature');
      }
      encoded = cursor.slice(0, dotIndex);
      const providedTag = cursor.slice(dotIndex + 1);
      const expectedTag = sign(encoded);
      if (providedTag !== expectedTag) {
        throw new Error('signature mismatch');
      }
    }

    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as CursorPayload).createdAt !== 'string' ||
      typeof (parsed as CursorPayload).id !== 'number' ||
      !Number.isInteger((parsed as CursorPayload).id) ||
      (parsed as CursorPayload).id < 0 ||
      isNaN(Date.parse((parsed as CursorPayload).createdAt))
    ) {
      throw new Error('invalid shape');
    }

    return parsed as CursorPayload;
  } catch {
    throw new BadRequestException(`Invalid cursor: "${cursor}"`);
  }
}

// ---------------------------------------------------------------------------
// Prisma WHERE builder
// ---------------------------------------------------------------------------

/**
 * Builds the Prisma `where` clause for keyset pagination.
 * Returns `undefined` when no cursor is provided (first page).
 *
 * The clause implements:
 *   WHERE (created_at < cursor.createdAt)
 *      OR (created_at = cursor.createdAt AND id < cursor.id)
 *
 * This correctly handles the tie-breaker without OFFSET.
 */
export function buildKeysetWhere(after?: string): KeysetWhere | undefined {
  if (!after) return undefined;
  const { createdAt, id } = decodeCursor(after);
  const ts = new Date(createdAt);
  return {
    OR: [
      { createdAt: { lt: ts } },
      { createdAt: { equals: ts }, id: { lt: id } },
    ],
  };
}

/**
 * Paginates an in-memory array using opaque offset-encoded cursors.
 * Compatible with the PageParams / CursorPageResult contract used by list endpoints.
 */
export function paginate<T>(items: T[], params: PageParams): CursorPageResult<T> {
  const limit = clampLimit(params.limit);
  const total = items.length;

  let startIndex = 0;
  if (params.after) {
    const decoded = Buffer.from(params.after, 'base64url').toString('utf8');
    const offset = Number(decoded);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new CursorError(`Invalid cursor: "${params.after}"`);
    }
    startIndex = offset;
  }

  const data = items.slice(startIndex, startIndex + limit);
  const nextOffset = startIndex + data.length;
  const next_cursor =
    data.length === limit && nextOffset < total
      ? Buffer.from(String(nextOffset), 'utf8').toString('base64url')
      : null;

  return { data, next_cursor, total };
}

/**
 * Builds the next_cursor from the last item in a page result.
 * Returns `null` when the page is the last one.
 *
 * @param items   Items returned for the current page.
 * @param limit   The clamped limit used for the query.
 * @param total   Total matching rows (used to detect last page).
 */
export function buildNextCursor<T extends { createdAt: Date; id: number }>(
  items: T[],
  limit: number,
  total: number,
): string | null {
  if (items.length === 0 || items.length < limit || total <= limit) return null;
  const last = items[items.length - 1];
  return encodeCursor(last.createdAt, last.id);
}
