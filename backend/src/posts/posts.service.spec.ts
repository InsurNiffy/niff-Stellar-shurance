import { Test, TestingModule } from '@nestjs/testing';
import { PostsService } from './posts.service';
import { PrismaService } from '../prisma/prisma.service';

const BASE_POST = {
  id: 1,
  title: 'Hello',
  body: 'placeholder',
  status: 'DRAFT',
  authorAddress: 'GBCPNZ6S7RK5N4BX6HBXBCX7P5QNBOJZFGDWBZBXCLK5T6KHWOPTLR3I',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

describe('PostsService — content sanitization', () => {
  let service: PostsService;
  let mockPrisma: { post: Record<string, jest.Mock> };

  beforeEach(async () => {
    mockPrisma = {
      post: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...BASE_POST, ...data })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...BASE_POST, ...data })),
        findFirst: jest.fn().mockResolvedValue(BASE_POST),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PostsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get(PostsService);
  });

  it('strips script tags from the post body on create', async () => {
    const result = await service.createPost({
      title: 'Hello',
      body: '<p>Hi</p><script>alert(1)</script>',
      status: 'draft',
      authorAddress: BASE_POST.authorAddress,
    });

    expect(result.body).not.toContain('<script');
    expect(result.body).toContain('Hi');
    expect(mockPrisma.post.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ body: expect.not.stringContaining('<script') }) }),
    );
  });

  it('strips event handler attributes from the post body on update', async () => {
    const result = await service.updatePost(1, {
      body: '<a href="https://example.com" onclick="alert(1)">link</a>',
    });

    expect(result.body).not.toContain('onclick');
    expect(result.body).toContain('href="https://example.com"');
  });

  it('preserves basic formatting through create', async () => {
    const result = await service.createPost({
      title: 'Hello',
      body: '<p><b>bold</b> and a <a href="https://example.com">link</a></p>',
      status: 'draft',
      authorAddress: BASE_POST.authorAddress,
    });

    expect(result.body).toContain('<b>bold</b>');
    expect(result.body).toContain('<a href="https://example.com">link</a>');
  });
});
