# Posts cursor pagination — test coverage

## What was implemented

The `GET /api/posts` endpoint (`posts.controller.ts`) and `PostsService.listPosts`
(`posts.service.ts`) already implement cursor-based (keyset) pagination on
top of the shared helpers in `../helpers/pagination.ts`:

- Ordering is `createdAt DESC, id DESC`, with `id` as a tie-breaker so rows
  sharing a `createdAt` still get a total order.
- `limit` is clamped server-side to `[1, MAX_LIMIT]` (`MAX_LIMIT = 100`,
  `DEFAULT_LIMIT = 20`) via `clampLimit()`, even when the client requests an
  excessive value.
- `after` is an opaque, base64url-encoded (optionally HMAC-signed) cursor
  encoding `{ createdAt, id }`, decoded/validated by `decodeCursor()`.
- The response envelope includes `pagination.next_cursor`, which is `null`
  once the last page has been returned.

What this change adds is **test coverage** for that behavior:
`backend/src/posts/posts.pagination.spec.ts` unit-tests `PostsService.listPosts`
against a mocked Prisma client seeded with 45 synthetic posts, covering:

1. **First page** — no `after` cursor returns the first `limit` rows plus a
   non-null `next_cursor`.
2. **Middle page** — following `next_cursor` returns the next page with no
   overlap and no gap relative to the previous page (verified by comparing
   the max id of page 2 against the min id of page 1).
3. **End of results** — repeatedly following `next_cursor` until it comes
   back `null` yields the last row (`id === 1`) and no further pages.
4. **Limit clamping** — requesting `limit: 10_000` never returns more than
   `MAX_LIMIT` rows.
5. **Default limit** — omitting `limit` falls back to `DEFAULT_LIMIT`.

## Why a README here

This commit's diff is under 150 lines (one new test file), so per the task
instructions for this batch of work, a short README summarizing the change
is included alongside it instead of relying on the diff alone.
