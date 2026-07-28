import { Test, TestingModule } from '@nestjs/testing';
import { PostPublishSchedulerService } from './post-publish-scheduler.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PostPublishSchedulerService', () => {
  let service: PostPublishSchedulerService;
  let mockPrisma: { post: Record<string, jest.Mock> };

  beforeEach(async () => {
    mockPrisma = {
      post: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PostPublishSchedulerService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get(PostPublishSchedulerService);
  });

  it('flips due, draft, non-deleted posts to PUBLISHED', async () => {
    await service.publishDuePosts();

    expect(mockPrisma.post.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'DRAFT',
        deletedAt: null,
        publishAt: { lte: expect.any(Date) },
      },
      data: { status: 'PUBLISHED' },
    });
  });

  it('does not throw when no posts are due', async () => {
    mockPrisma.post.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.publishDuePosts()).resolves.toBeUndefined();
  });
});
