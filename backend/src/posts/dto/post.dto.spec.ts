/**
 * DTO validation tests for the Posts module.
 *
 * Covers: CreatePostDtoSchema, UpdatePostDtoSchema, PostsQueryDtoSchema
 * Closes: #1000 — Backend Posts: Add DTO validation tests for invalid input
 */

import {
  CreatePostDtoSchema,
  UpdatePostDtoSchema,
  PostsQueryDtoSchema,
} from './post.dto';

// ── CreatePostDtoSchema ────────────────────────────────────────────────────────

describe('CreatePostDtoSchema', () => {
  const valid = {
    title: 'Hello World',
    body: 'This is a valid post body.',
    authorAddress: 'GDVOEGATQV4FGUJKDEBEYT5NAPWJ55MEMJVLC5TU7Y74WD73PPAS4TYW',
  };

  it('accepts a valid payload with defaults', () => {
    const result = CreatePostDtoSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('draft'); // default
    }
  });

  it('accepts an explicit published status', () => {
    const result = CreatePostDtoSchema.safeParse({ ...valid, status: 'published' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid status value', () => {
    const result = CreatePostDtoSchema.safeParse({ ...valid, status: 'hidden' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing title', () => {
    const { title, ...rest } = valid;
    expect(title).toBe('Hello World');
    const result = CreatePostDtoSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects an empty title', () => {
    const result = CreatePostDtoSchema.safeParse({ ...valid, title: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('empty');
    }
  });

  it('rejects a title exceeding 200 characters', () => {
    const result = CreatePostDtoSchema.safeParse({ ...valid, title: 'a'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('accepts a title of exactly 200 characters', () => {
    const result = CreatePostDtoSchema.safeParse({ ...valid, title: 'a'.repeat(200) });
    expect(result.success).toBe(true);
  });

  it('rejects a missing body', () => {
    const { body, ...rest } = valid;
    expect(body).toBeDefined();
    const result = CreatePostDtoSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects an empty body', () => {
    const result = CreatePostDtoSchema.safeParse({ ...valid, body: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a body exceeding 10000 characters', () => {
    const result = CreatePostDtoSchema.safeParse({ ...valid, body: 'x'.repeat(10_001) });
    expect(result.success).toBe(false);
  });

  it('accepts a body of exactly 10000 characters', () => {
    const result = CreatePostDtoSchema.safeParse({ ...valid, body: 'x'.repeat(10_000) });
    expect(result.success).toBe(true);
  });

  it('rejects a missing authorAddress', () => {
    const { authorAddress, ...rest } = valid;
    expect(authorAddress).toBeDefined();
    const result = CreatePostDtoSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects a malformed authorAddress (not a Stellar key)', () => {
    const result = CreatePostDtoSchema.safeParse({ ...valid, authorAddress: 'not-a-key' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('Stellar public key');
    }
  });

  it('rejects an authorAddress starting with wrong letter', () => {
    const result = CreatePostDtoSchema.safeParse({
      ...valid,
      authorAddress: 'SDVOEGATQV4FGUJKDEBEYT5NAPWJ55MEMJVLC5TU7Y74WD73PPAS4TYW',
    });
    expect(result.success).toBe(false);
  });

  it('rejects extra fields (unknown keys are stripped by Zod, so no error)', () => {
    // Zod strips unknown fields by default — no error expected
    const result = CreatePostDtoSchema.safeParse({ ...valid, unknownField: 'value' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).unknownField).toBeUndefined();
    }
  });
});

// ── UpdatePostDtoSchema ────────────────────────────────────────────────────────

describe('UpdatePostDtoSchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    const result = UpdatePostDtoSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a partial update with only title', () => {
    const result = UpdatePostDtoSchema.safeParse({ title: 'New Title' });
    expect(result.success).toBe(true);
  });

  it('accepts a status change to archived', () => {
    const result = UpdatePostDtoSchema.safeParse({ status: 'archived' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty title string', () => {
    const result = UpdatePostDtoSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a title over 200 characters', () => {
    const result = UpdatePostDtoSchema.safeParse({ title: 'b'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('rejects an empty body string', () => {
    const result = UpdatePostDtoSchema.safeParse({ body: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a body over 10000 characters', () => {
    const result = UpdatePostDtoSchema.safeParse({ body: 'z'.repeat(10_001) });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid status value', () => {
    const result = UpdatePostDtoSchema.safeParse({ status: 'deleted' });
    expect(result.success).toBe(false);
  });
});

// ── PostsQueryDtoSchema ────────────────────────────────────────────────────────

describe('PostsQueryDtoSchema', () => {
  it('accepts an empty query (all defaults)', () => {
    const result = PostsQueryDtoSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });

  it('accepts valid status filter', () => {
    const result = PostsQueryDtoSchema.safeParse({ status: 'published' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status filter', () => {
    const result = PostsQueryDtoSchema.safeParse({ status: 'removed' });
    expect(result.success).toBe(false);
  });

  it('accepts a valid authorAddress filter', () => {
    const result = PostsQueryDtoSchema.safeParse({
      authorAddress: 'GDVOEGATQV4FGUJKDEBEYT5NAPWJ55MEMJVLC5TU7Y74WD73PPAS4TYW',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed authorAddress in query', () => {
    const result = PostsQueryDtoSchema.safeParse({ authorAddress: 'bad-address' });
    expect(result.success).toBe(false);
  });

  it('rejects limit = 0', () => {
    const result = PostsQueryDtoSchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects limit = 101', () => {
    const result = PostsQueryDtoSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it('accepts limit = 100 (maximum)', () => {
    const result = PostsQueryDtoSchema.safeParse({ limit: 100 });
    expect(result.success).toBe(true);
  });

  it('rejects a non-integer limit', () => {
    const result = PostsQueryDtoSchema.safeParse({ limit: 10.5 });
    expect(result.success).toBe(false);
  });
});
