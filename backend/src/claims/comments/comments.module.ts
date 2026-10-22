import { Module } from '@nestjs/common';
import { CommentController } from './comment.controller';
import { CommentService } from './comment.service';
import { CommentRepository } from './comment.repository';
import { SanitizationService } from '../sanitization.service';
import { RateLimitModule } from '../../rate-limit/rate-limit.module';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [RateLimitModule, AuthModule],
  controllers: [CommentController],
  providers: [CommentService, CommentRepository, SanitizationService],
  exports: [CommentService],
})
export class CommentsModule {}
