import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Req,
  Body,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PostsService } from './posts.service';
import {
  PostResponseDto,
  PostsListResponseDto,
  CreatePostDtoSchema,
  UpdatePostDtoSchema,
  PostsQueryDtoSchema,
} from './dto/post.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { WalletAddress } from '../auth/decorators/wallet-address.decorator';
import { MAX_LIMIT, DEFAULT_LIMIT } from '../helpers/pagination';

@ApiTags('posts')
@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  /**
   * GET /api/posts
   *
   * Public endpoint. Returns a cursor-paginated list of posts.
   * Supports filtering by status and authorAddress. Posts scheduled for a
   * future publishAt are hidden unless the caller is authenticated.
   */
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'List posts with cursor-based pagination' })
  @ApiQuery({ name: 'after', required: false, type: String, description: 'Opaque cursor from a previous response next_cursor.' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: `Items per page. Clamped to [1, ${MAX_LIMIT}]. Default ${DEFAULT_LIMIT}.` })
  @ApiQuery({ name: 'status', required: false, enum: ['draft', 'published', 'archived'], description: 'Filter by post status.' })
  @ApiQuery({ name: 'authorAddress', required: false, type: String, description: 'Filter by author Stellar address.' })
  @ApiResponse({ status: 200, description: 'Paginated list of posts', type: PostsListResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid query parameter or cursor' })
  async listPosts(
    @Req() req: Request,
    @Query('after') after?: string,
    @Query('limit', new DefaultValuePipe(DEFAULT_LIMIT), ParseIntPipe) limit?: number,
    @Query('status') status?: string,
    @Query('authorAddress') authorAddress?: string,
  ): Promise<PostsListResponseDto> {
    const query = PostsQueryDtoSchema.safeParse({ after, limit, status, authorAddress });
    if (!query.success) {
      throw new BadRequestException(query.error.issues[0]?.message ?? 'Invalid query params');
    }
    return this.postsService.listPosts({ ...query.data, includeScheduled: Boolean(req.user) });
  }

  /**
   * GET /api/posts/:id
   *
   * Public endpoint. Returns a single post by numeric ID. A post scheduled
   * for a future publishAt is treated as not found unless the caller is
   * authenticated (preview access).
   */
  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get a single post by ID' })
  @ApiResponse({ status: 200, description: 'Post detail', type: PostResponseDto })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async getPost(@Param('id', ParseIntPipe) id: number, @Req() req: Request): Promise<PostResponseDto> {
    return this.postsService.getPost(id, Boolean(req.user));
  }

  /**
   * POST /api/posts
   *
   * Authenticated. Creates a new post.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new post' })
  @ApiResponse({ status: 201, description: 'Post created', type: PostResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async createPost(
    @Body() body: unknown,
    @WalletAddress() _walletAddress: string,
  ): Promise<PostResponseDto> {
    const parsed = CreatePostDtoSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Validation failed');
    }
    return this.postsService.createPost(parsed.data);
  }

  /**
   * PATCH /api/posts/:id
   *
   * Authenticated. Partially updates a post.
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a post (partial)' })
  @ApiResponse({ status: 200, description: 'Post updated', type: PostResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async updatePost(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<PostResponseDto> {
    const parsed = UpdatePostDtoSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Validation failed');
    }
    return this.postsService.updatePost(id, parsed.data);
  }

  /**
   * DELETE /api/posts/:id
   *
   * Authenticated. Soft-deletes a post.
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft-delete a post' })
  @ApiResponse({ status: 204, description: 'Post deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async deletePost(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.postsService.deletePost(id);
  }
}
