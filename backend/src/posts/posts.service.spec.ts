import { Test, TestingModule } from '@nestjs/testing';
import { PostsService } from './posts.service';
import { PrismaService } from '../prisma/prisma.service';

const AUTHOR = 'GBCPNZ6S7RK5N4BX6HBXBCX7P5QNBOJZFGDWBZBXCLK5T6KHWOPTLR3I';

function makePost(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    title: 'Hello',
    body: 'body',
    status: 'DRAFT',
    authorAddress: AUTHOR,
    publishAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('PostsService — publish scheduling', () => {
  let service: PostsService;
  let mockPrisma: { post: Record<string, jest.Mock> };

  function setup(rows: ReturnType<typeof makePost>[], total = rows.length) {
    mockPrisma = {
      post: {
        findMany: jest.fn().mockResolvedValue(rows),
        count: jest.fn().mockResolvedValue(total),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
  }

  async function buildService() {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PostsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    return module.get(PostsService);
  }

  describe('listPosts', () => {
    it('excludes a future-publishAt post for anonymous callers', async () => {
      setup([]);
      service = await buildService();

      await service.listPosts({});

      const where = mockPrisma.post.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ publishAt: null }, { publishAt: { lte: expect.any(Date) } }]);
    });

    it('does not filter by publishAt when includeScheduled is true', async () => {
      setup([]);
      service = await buildService();

      await service.listPosts({ includeScheduled: true });

      const where = mockPrisma.post.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
    });
  });

  describe('getPost', () => {
    it('hides a post scheduled in the future from anonymous callers', async () => {
      const future = new Date(Date.now() + 60_000);
      mockPrisma = {
        post: {
          findFirst: jest.fn().mockResolvedValue(makePost({ publishAt: future })),
          findMany: jest.fn(),
          count: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
      };
      service = await buildService();

      await expect(service.getPost(1)).rejects.toThrow('Post 1 not found');
    });

    it('becomes visible once publishAt has passed', async () => {
      const past = new Date(Date.now() - 60_000);
      mockPrisma = {
        post: {
          findFirst: jest.fn().mockResolvedValue(makePost({ publishAt: past })),
          findMany: jest.fn(),
          count: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
      };
      service = await buildService();

      const result = await service.getPost(1);
      expect(result.id).toBe(1);
    });

    it('allows an authenticated caller to preview a future-scheduled post', async () => {
      const future = new Date(Date.now() + 60_000);
      mockPrisma = {
        post: {
          findFirst: jest.fn().mockResolvedValue(makePost({ publishAt: future })),
          findMany: jest.fn(),
          count: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
      };
      service = await buildService();

      const result = await service.getPost(1, true);
      expect(result.publishAt).toEqual(future);
    });
  });

  describe('createPost / updatePost', () => {
    it('persists publishAt on create', async () => {
      const publishAt = new Date(Date.now() + 3600_000);
      mockPrisma = {
        post: {
          create: jest.fn().mockImplementation(({ data }) => Promise.resolve(makePost({ ...data }))),
          findFirst: jest.fn(),
          findMany: jest.fn(),
          count: jest.fn(),
          update: jest.fn(),
        },
      };
      service = await buildService();

      const result = await service.createPost({
        title: 'Hello',
        body: 'body',
        status: 'draft',
        authorAddress: AUTHOR,
        publishAt,
      });

      expect(result.publishAt).toEqual(publishAt);
      expect(mockPrisma.post.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ publishAt }) }),
      );
    });

    it('updates publishAt when provided', async () => {
      const publishAt = new Date(Date.now() + 3600_000);
      mockPrisma = {
        post: {
          findFirst: jest.fn().mockResolvedValue(makePost()),
          update: jest.fn().mockImplementation(({ data }) => Promise.resolve(makePost({ ...data }))),
          findMany: jest.fn(),
          count: jest.fn(),
          create: jest.fn(),
        },
      };
      service = await buildService();

      const result = await service.updatePost(1, { publishAt });
      expect(result.publishAt).toEqual(publishAt);
    });
  });
});
