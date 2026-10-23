import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { postBus, POST_PUBLISHED_EVENT, PostPublishedEvent } from './post-events';

/**
 * Flips scheduled draft posts to PUBLISHED once their publishAt passes, so
 * the admin UI's status field stays accurate. Public visibility itself is
 * enforced at read time in PostsService regardless of this job's cadence.
 */
@Injectable()
export class PostPublishSchedulerService {
  private readonly logger = new Logger(PostPublishSchedulerService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async publishDuePosts(): Promise<void> {
    const where = {
      status: 'DRAFT' as const,
      deletedAt: null,
      publishAt: { lte: new Date() },
    };
    const due = await this.prisma.post.findMany({ where });
    if (due.length === 0) return;

    await this.prisma.post.updateMany({
      where: { id: { in: due.map((p) => p.id) }, status: 'DRAFT' },
      data: { status: 'PUBLISHED' },
    });

    for (const post of due) {
      const event: PostPublishedEvent = {
        postId: post.id,
        title: post.title,
        authorAddress: post.authorAddress,
        publishedAt: new Date(),
      };
      postBus.emit(POST_PUBLISHED_EVENT, event);
    }
    this.logger.log(`Published ${due.length} scheduled post(s)`);
  }
}
