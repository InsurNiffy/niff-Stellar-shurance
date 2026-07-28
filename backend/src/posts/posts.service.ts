import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PostResponseDto,
  PostsListResponseDto,
  CreatePostDto,
  UpdatePostDto,
  PostStatus,
} from './dto/post.dto';
import {
  buildKeysetWhere,
  buildNextCursor,
  clampLimit,
  PageParams,
} from '../helpers/pagination';
import { sanitizePostBody } from './sanitize-post-body';

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPosts(params: PageParams & { status?: PostStatus; authorAddress?: string }): Promise<PostsListResponseDto> {
    const limit = clampLimit(params.limit);
    const keysetWhere = buildKeysetWhere(params.after);

    const where = {
      ...(keysetWhere ?? {}),
      deletedAt: null,
      ...(params.status ? { status: params.status.toUpperCase() } : {}),
      ...(params.authorAddress ? { authorAddress: params.authorAddress } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.post.count({ where: params.status || params.authorAddress
        ? {
            deletedAt: null,
            ...(params.status ? { status: params.status.toUpperCase() } : {}),
            ...(params.authorAddress ? { authorAddress: params.authorAddress } : {}),
          }
        : { deletedAt: null },
      }),
      this.prisma.post.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
    ]);

    const next_cursor = buildNextCursor(rows, limit, total);

    return {
      data: rows.map(this.toDto),
      pagination: { next_cursor, total },
    };
  }

  async getPost(id: number): Promise<PostResponseDto> {
    const post = await this.prisma.post.findFirst({ where: { id, deletedAt: null } });
    if (!post) throw new NotFoundException(`Post ${id} not found`);
    return this.toDto(post);
  }

  async createPost(dto: CreatePostDto): Promise<PostResponseDto> {
    const post = await this.prisma.post.create({
      data: {
        title: dto.title,
        body: sanitizePostBody(dto.body),
        status: dto.status?.toUpperCase() ?? 'DRAFT',
        authorAddress: dto.authorAddress,
      },
    });
    return this.toDto(post);
  }

  async updatePost(id: number, dto: UpdatePostDto): Promise<PostResponseDto> {
    const existing = await this.prisma.post.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException(`Post ${id} not found`);

    const post = await this.prisma.post.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.body !== undefined ? { body: sanitizePostBody(dto.body) } : {}),
        ...(dto.status !== undefined ? { status: dto.status.toUpperCase() } : {}),
      },
    });
    return this.toDto(post);
  }

  async deletePost(id: number): Promise<void> {
    const existing = await this.prisma.post.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException(`Post ${id} not found`);
    await this.prisma.post.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private toDto(post: {
    id: number;
    title: string;
    body: string;
    status: string;
    authorAddress: string;
    createdAt: Date;
    updatedAt: Date;
  }): PostResponseDto {
    return {
      id: post.id,
      title: post.title,
      body: post.body,
      status: post.status.toLowerCase() as PostStatus,
      authorAddress: post.authorAddress,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
  }
}
