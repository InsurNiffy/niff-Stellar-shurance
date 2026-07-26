import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

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
    const result = await this.prisma.post.updateMany({
      where: {
        status: 'DRAFT',
        deletedAt: null,
        publishAt: { lte: new Date() },
      },
      data: { status: 'PUBLISHED' },
    });

    if (result.count > 0) {
      this.logger.log(`Published ${result.count} scheduled post(s)`);
    }
  }
}
