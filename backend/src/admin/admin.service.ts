import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Queue } from 'bullmq';
import { getBullMQConnection } from '../redis/client';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private reindexQueue: Queue;

  constructor(private readonly prisma: PrismaService) {
    this.reindexQueue = new Queue('reindex', {
      connection: getBullMQConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    });
  }

  async enqueueReindex(fromLedger: number): Promise<string> {
    const job = await this.reindexQueue.add('reindex', { fromLedger }, { jobId: `reindex-${fromLedger}-${Date.now()}` });
    this.logger.log(`Reindex job enqueued: ${job.id} from ledger ${fromLedger}`);
    return job.id!;
  }

  async setFeatureFlag(key: string, enabled: boolean, description: string | undefined, actor: string) {
    return this.prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled, description, updatedBy: actor },
      update: { enabled, description, updatedBy: actor },
    });
  }

  async getFeatureFlags() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }
}
