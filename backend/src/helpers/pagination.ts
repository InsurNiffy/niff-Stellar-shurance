/**
 * Reusable cursor-based pagination helpers shared across all list endpoints.
 *
 * Cursor strategy
 * ───────────────
 * The cursor encodes the `global_seq` of the last item returned, base64url-
 * encoded so it is opaque to clients. This gives stable, keyset-style
 * pagination that scales under concurrent inserts:
 *
 *   - New rows inserted after the cursor position do NOT shift existing pages.
 *   - Rows inserted before the cursor position (backfill) may be skipped —
 *     this is documented, expected behaviour for append-heavy workloads.
 *   - Deleted rows cause the next page to simply skip the gap; no error.
 *
 * Staleness contract (documented for consumers)
 * ──────────────────────────────────────────────
 * Cursors are point-in-time snapshots of `global_seq`. If a policy is
 * updated between pages, the updated version is returned on the page where
 * its seq falls. Clients must not assume immutability of individual records
 * across pages, only that the ordering is stable.
 */

export interface PageParams {
  /** Opaque cursor string from a previous response's `next_cursor`. */
  after?: string;
  /** Maximum items per page. Clamped to [1, MAX_LIMIT]. */
  limit?: number;
}

export interface PageResult<T> {
  data: T[];
  /** Opaque cursor to pass as `after` for the next page. Null if no more pages. */
  next_cursor: string | null;
  /** Total items matching the filter (before pagination). */
  total: number;
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/**
 * Encodes a global_seq integer into an opaque base64url cursor string.
 */
export function encodeCursor(seq: number): string {
  return Buffer.from(String(seq), "utf8").toString("base64url");
}

/**
 * Decodes a cursor string back to a global_seq integer.
 * Throws a typed error on invalid input so controllers can return 400.
 */
export function decodeCursor(cursor: string): number {
  let raw: string;
  try {
    raw = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new CursorError(`Invalid cursor: "${cursor}"`);
  }
  const seq = parseInt(raw, 10);
  if (!Number.isInteger(seq) || seq < 0) {
    throw new CursorError(`Invalid cursor: "${cursor}"`);
  }
  return seq;
}

export class CursorError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "CursorError";
  }
}

/**
 * Applies cursor + limit to a pre-filtered, pre-sorted array.
 * Items must already be sorted ascending by `global_seq`.
 *
 * @param items   Full filtered list, sorted by global_seq ASC.
 * @param params  Pagination parameters from the request.
 */
export function paginate<T extends { global_seq: number }>(
  items: T[],
  params: PageParams
): PageResult<T> {
  const limit = Math.min(
    Math.max(1, params.limit ?? DEFAULT_LIMIT),
    MAX_LIMIT
  );

  let startIndex = 0;
  if (params.after !== undefined) {
    const afterSeq = decodeCursor(params.after); // throws CursorError on bad input
    // Find the first item whose seq is strictly greater than the cursor
    startIndex = items.findIndex((item) => item.global_seq > afterSeq);
    if (startIndex === -1) {
      // Cursor is past the end of the list
      return { data: [], next_cursor: null, total: items.length };
    }
  }

  const page = items.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < items.length;
  const next_cursor =
    hasMore && page.length > 0
      ? encodeCursor(page[page.length - 1].global_seq)
      : null;

  return { data: page, next_cursor, total: items.length };
}
