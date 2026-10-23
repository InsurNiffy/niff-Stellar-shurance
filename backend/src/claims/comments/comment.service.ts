import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { AppException } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { SanitizationService } from '../sanitization.service';
import { CommentRepository } from './comment.repository';
import { DEFAULT_LIMIT, clampLimit } from '../../helpers/pagination';
import type { CommentListResponseDto, CommentResponseDto } from './comment.dto';
import { enqueueClaimCommentReply } from './comment-notification.queue';

export const COMMENT_RATE_LIMIT = 5;
export const COMMENT_RATE_WINDOW_SECONDS = 3600;

@Injectable()
export class CommentService {
  constructor(
    private readonly repo: CommentRepository,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly sanitization: SanitizationService,
  ) {}

  async list(claimId: number, after?: string, limit?: number): Promise<CommentListResponseDto> {
    await this.assertClaimExists(claimId);
    const take = clampLimit(limit ?? DEFAULT_LIMIT);
    const rows = await this.repo.findActive(claimId, after, take);
    const page = rows.slice(0, take);
    return {
      data: page.map(this.toDto),
      next_cursor: rows.length > take ? page[page.length - 1].id : null,
    };
  }

  async moderate(
    claimId: number,
    commentId: string,
    data: { body?: string; hidden?: boolean },
  ): Promise<CommentResponseDto> {
    const comment = await this.repo.findById(commentId);
    if (!comment || comment.claimId !== claimId || comment.deletedAt !== null) {
      throw new NotFoundException('Comment not found');
    }
    const body = data.body !== undefined ? this.sanitization.sanitizeDescription(data.body) : undefined;
    return this.toDto(await this.repo.moderate(commentId, { body, hidden: data.hidden }));
  }

  async create(
    claimId: number,
    authorAddress: string,
    body: string,
    parentId?: string,
  ): Promise<CommentResponseDto> {
    await this.assertClaimExists(claimId);

    let parent: Awaited<ReturnType<CommentRepository['findById']>> = null;
    if (parentId) {
      parent = await this.repo.findById(parentId);
      if (!parent || parent.claimId !== claimId || parent.deletedAt !== null) {
        throw new NotFoundException('Parent comment not found');
      }
    }

    // Max 5 comments per claim per hour per wallet
    const { allowed, retryAfterSeconds } = await this.rateLimit.checkWalletEvidenceLimit(
      `comment:${claimId}:${authorAddress}`,
      COMMENT_RATE_LIMIT,
      COMMENT_RATE_WINDOW_SECONDS,
    );
    if (!allowed) {
      throw new AppException('RATE_LIMIT_EXCEEDED', {
        message: `Rate limit exceeded. Retry after ${retryAfterSeconds}s.`,
        details: { retryAfter: retryAfterSeconds },
      });
    }

    const sanitizedBody = this.sanitization.sanitizeDescription(body);
    const comment = await this.repo.create(claimId, authorAddress, sanitizedBody, parentId);
    if (parent && parent.authorAddress !== authorAddress) {
      enqueueClaimCommentReply({
        parentAuthorAddress: parent.authorAddress,
        claimId,
        commentId: comment.id,
        parentId: parent.id,
      }).catch(() => undefined); // notification is best-effort
    }
    return this.toDto(comment);
  }

  async softDelete(
    commentId: string,
    walletAddress: string,
    isAdmin: boolean,
    deletedBy?: string,
  ): Promise<void> {
    const comment = await this.repo.findById(commentId);
    if (!comment || comment.deletedAt !== null) {
      throw new NotFoundException('Comment not found');
    }
    if (!isAdmin && comment.authorAddress !== walletAddress) {
      throw new ForbiddenException('Not authorized to delete this comment');
    }
    await this.repo.softDelete(commentId, deletedBy);
  }

  private async assertClaimExists(claimId: number): Promise<void> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      select: { id: true, deletedAt: true },
    });
    if (!claim || claim.deletedAt !== null) {
      throw new NotFoundException(`Claim ${claimId} not found`);
    }
  }

  private toDto(c: {
    id: string;
    claimId: number;
    authorAddress: string;
    body: string;
    createdAt: Date;
    deletedAt: Date | null;
    parentId?: string | null;
  }): CommentResponseDto {
    return {
      id: c.id,
      claimId: c.claimId,
      authorAddress: c.authorAddress,
      body: c.body,
      createdAt: c.createdAt,
      parentId: c.parentId ?? null,
    };
  }
}
