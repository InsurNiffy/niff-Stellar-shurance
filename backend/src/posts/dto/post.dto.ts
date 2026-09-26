import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import {
  IsInt,
  IsPositive,
  IsString,
  IsOptional,
  MaxLength,
  MinLength,
  IsEnum,
  IsDate,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { z } from 'zod';

// ── Zod schema (used for incoming request validation) ─────────────────────────

export const PostStatusSchema = z.enum(['draft', 'published', 'archived']);

export const CreatePostDtoSchema = z.object({
  title: z
    .string()
    .min(1, 'title must not be empty')
    .max(200, 'title must be at most 200 characters'),
  body: z
    .string()
    .min(1, 'body must not be empty')
    .max(10_000, 'body must be at most 10000 characters'),
  status: PostStatusSchema.optional().default('draft'),
  authorAddress: z
    .string()
    .regex(/^G[A-Z2-7]{55}$/, 'authorAddress must be a valid Stellar public key (G...)'),
  /** Optional future timestamp to schedule the post instead of publishing immediately. */
  publishAt: z.coerce.date().optional(),
});

export type CreatePostDto = z.infer<typeof CreatePostDtoSchema>;

export const UpdatePostDtoSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(10_000).optional(),
  status: PostStatusSchema.optional(),
  publishAt: z.coerce.date().nullable().optional(),
});

export type UpdatePostDto = z.infer<typeof UpdatePostDtoSchema>;

// ── Response DTOs (class-validator + Swagger for outbound serialisation) ──────

export type PostStatus = 'draft' | 'published' | 'archived';

export class PostResponseDto {
  @ApiProperty({ description: 'Unique post identifier' })
  @Expose()
  @IsInt()
  @IsPositive()
  id!: number;

  @ApiProperty({ description: 'Post title', maxLength: 200 })
  @Expose()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ description: 'Post body content', maxLength: 10_000 })
  @Expose()
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  body!: string;

  @ApiProperty({ description: 'Post publication status', enum: ['draft', 'published', 'archived'] })
  @Expose()
  @IsEnum(['draft', 'published', 'archived'])
  status!: PostStatus;

  @ApiProperty({ description: 'Author Stellar wallet address' })
  @Expose()
  @IsString()
  authorAddress!: string;

  @ApiPropertyOptional({ description: 'Scheduled publish timestamp; null if not scheduled', nullable: true })
  @Expose()
  @IsOptional()
  @IsDate()
  publishAt?: Date | null;

  @ApiProperty({ description: 'Creation timestamp' })
  @Expose()
  @IsDate()
  createdAt!: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  @Expose()
  @IsDate()
  updatedAt!: Date;
}

export class PostPaginationDto {
  @ApiProperty({ description: 'Opaque cursor for the next page. Null when no more pages exist.', nullable: true })
  @Expose()
  next_cursor!: string | null;

  @ApiProperty({ description: 'Total posts matching the filter before pagination', example: 42 })
  @Expose()
  @IsInt()
  @Min(0)
  total!: number;
}

export class PostsListResponseDto {
  @ApiProperty({ description: 'Array of posts', type: [PostResponseDto] })
  @Expose()
  @ValidateNested({ each: true })
  @Type(() => PostResponseDto)
  data!: PostResponseDto[];

  @ApiProperty({ description: 'Cursor pagination metadata', type: PostPaginationDto })
  @Expose()
  pagination!: PostPaginationDto;
}

// ── Query DTO (pagination + filter params) ────────────────────────────────────

export const PostsQueryDtoSchema = z.object({
  after: z.string().optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20),
  status: PostStatusSchema.optional(),
  authorAddress: z
    .string()
    .regex(/^G[A-Z2-7]{55}$/)
    .optional(),
});

export type PostsQueryDto = z.infer<typeof PostsQueryDtoSchema>;

export class PostResponseWithOptionalFields extends PostResponseDto {
  @ApiPropertyOptional({ description: 'Whether the authenticated user is the author' })
  @Expose()
  @IsOptional()
  isAuthor?: boolean;
}
