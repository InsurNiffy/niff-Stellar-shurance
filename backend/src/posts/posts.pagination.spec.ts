import { Test, TestingModule } from '@nestjs/testing';
import { PostsService } from './posts.service';
import { PrismaService } from '../prisma/prisma.service';
import { encodeCursor, MAX_LIMIT, DEFAULT_LIMIT } from '../helpers/pagination';

/**
 * Builds `count` synthetic posts, newest first (matches the service's
 * `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`), so tests can slice
 * pages out of a stable, known dataset.
 */
function buildPosts(count: number) {
  const base = new Date('2024-06-01T00:00:00.000Z').getTime();
  return Array.from({ length: count }, (_, i) => {
    const id = count - i;
    return {
      id,
      title: `Post ${id}`,
      body: 'placeholder',
      status: 'PUBLISHED',
      authorAddress: 'GBCPNZ6S7RK5N4BX6HBXBCX7P5QNBOJZFGDWBZBXCLK5T6KHWOPTLR3I',
      publishAt: null,
      createdAt: new Date(base - i * 60_000),
      updatedAt: new Date(base - i * 60_000),
    };
  });
}

describe('PostsService — cursor pagination', () => {
  let service: PostsService;
  const ALL_POSTS = buildPosts(45);

  function applyKeysetFilter(where: unknown): typeof ALL_POSTS {
    const w = where as { OR?: unknown };
    if (!w.OR) return ALL_POSTS;
    // Only the keyset OR clause is exercised here; other where fields are
    // static in these tests (no status/authorAddress filters applied).
    const or = w.OR as Array<{ createdAt?: { lt?: Date; equals?: Date }; id?: { lt?: number } }>;
    const [ltClause, eqClause] = or;
    return ALL_POSTS.filter((p) => {
      const beforeByTime = ltClause.createdAt?.lt && p.createdAt < ltClause.createdAt.lt;
      const tieBreak =
        eqClause?.createdAt?.equals &&
        p.createdAt.getTime() === eqClause.createdAt.equals.getTime() &&
        eqClause.id?.lt !== undefined &&
        p.id < eqClause.id.lt;
      return Boolean(beforeByTime || tieBreak);
    });
  }

  beforeEach(async () => {
    const mockPrisma = {
      post: {
        findMany: jest.fn().mockImplementation(({ where, take }) => {
          const filtered = applyKeysetFilter(where);
          return Promise.resolve(filtered.slice(0, take));
        }),
        count: jest.fn().mockResolvedValue(ALL_POSTS.length),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PostsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get(PostsService);
  });

  it('returns the first page with a nextCursor when more rows exist', async () => {
    const result = await service.listPosts({ limit: 10 });

    expect(result.data).toHaveLength(10);
    expect(result.data[0].id).toBe(45);
    expect(result.data[9].id).toBe(36);
    expect(result.pagination.next_cursor).not.toBeNull();
    expect(result.pagination.total).toBe(45);
  });

  it('returns a middle page with no overlap or gaps when following nextCursor', async () => {
    const page1 = await service.listPosts({ limit: 10 });
    const page2 = await service.listPosts({ limit: 10, after: page1.pagination.next_cursor! });

    const page1Ids = page1.data.map((p) => p.id);
    const page2Ids = page2.data.map((p) => p.id);

    expect(page2Ids).toHaveLength(10);
    // No overlap between consecutive pages.
    expect(page1Ids.filter((id) => page2Ids.includes(id))).toHaveLength(0);
    // No gap: the page2 items pick up exactly where page1 left off.
    expect(Math.max(...page2Ids)).toBe(Math.min(...page1Ids) - 1);
  });

  it('returns the final page with a null nextCursor at end-of-results', async () => {
    let cursor: string | null = null;
    let lastPage;
    do {
      lastPage = await service.listPosts({ limit: 20, after: cursor ?? undefined });
      cursor = lastPage.pagination.next_cursor;
    } while (cursor !== null);

    expect(lastPage.data.length).toBeGreaterThan(0);
    expect(lastPage.pagination.next_cursor).toBeNull();
    expect(lastPage.data[lastPage.data.length - 1].id).toBe(1);
  });

  it('clamps an excessive client-requested limit to MAX_LIMIT', async () => {
    const result = await service.listPosts({ limit: 10_000 });
    expect(result.data.length).toBeLessThanOrEqual(MAX_LIMIT);
  });

  it('falls back to DEFAULT_LIMIT when no limit is supplied', async () => {
    const result = await service.listPosts({});
    expect(result.data).toHaveLength(Math.min(DEFAULT_LIMIT, ALL_POSTS.length));
  });

  it('produces a decodable, well-formed cursor', async () => {
    const result = await service.listPosts({ limit: 5 });
    expect(() => encodeCursor(new Date(), 1)).not.toThrow();
    expect(typeof result.pagination.next_cursor).toBe('string');
  });
});
