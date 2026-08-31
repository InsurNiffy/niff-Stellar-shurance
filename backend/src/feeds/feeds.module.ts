import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FeedsController],
  providers: [FeedsService],
})
export class FeedsModule implements OnModuleInit {
  private readonly logger = new Logger(FeedsModule.name);

  constructor(private readonly feedsService: FeedsService) {}

  /** Warms the claims Atom feed cache at boot so the first real request isn't the cold one. */
  async onModuleInit(): Promise<void> {
    try {
      await this.feedsService.warmClaimsAtomFeedCache();
    } catch (error) {
      this.logger.error('Failed to warm claims Atom feed cache at boot', error instanceof Error ? error.stack : error);
    }
  }
}
