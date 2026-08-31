import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { PostPublishSchedulerService } from './post-publish-scheduler.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule],
  controllers: [PostsController],
  providers: [PostsService, PostPublishSchedulerService],
  exports: [PostsService],
})
export class PostsModule {}
