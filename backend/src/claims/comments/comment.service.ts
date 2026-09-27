import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { SanitizationService } from '../sanitization.service';
import { CommentRepository } from './comment.repository';
import type { CommentResponseDto } from './comment.dto';

@Injectable()
export class CommentService {
  constructor(
    private readonly repo: CommentRepository,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly sanitization: SanitizationService,
  ) {}

  async list(claimId: number): Promise<CommentResponseDto[]> {
    await this.assertClaimExists(claimId);
    const rows = await this.repo.findActive(claimId);
    return rows.map(this.toDto);
  }

  async create(
    claimId: number,
    authorAddress: string,
    body: string,
  ): Promise<CommentResponseDto> {
    await this.assertClaimExists(claimId);

    // Per-wallet-per-claim rate limit key
    const rateLimitKey = `comment:${authorAddress.toLowerCase()}:${claimId}`;
    const { allowed, retryAfterSeconds } = await this.rateLimit.checkWalletLimit(rateLimitKey);
    if (!allowed) {
      throw new HttpException(
        `Rate limit exceeded. Retry after ${retryAfterSeconds}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const sanitizedBody = this.sanitization.sanitizeDescription(body);
    const comment = await this.repo.create(claimId, authorAddress, sanitizedBody);
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
  }): CommentResponseDto {
    return {
      id: c.id,
      claimId: c.claimId,
      authorAddress: c.authorAddress,
      body: c.body,
      createdAt: c.createdAt,
    };
  }
}
