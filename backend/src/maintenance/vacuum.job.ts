import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import { getBullMQConnection } from '../redis/client';
import { VacuumService } from './vacuum.service';

const QUEUE_NAME = 'vacuum';
const JOB_NAME = 'weekly-vacuum-analyze';
const REPEATABLE_JOB_KEY = 'vacuum-scheduled';

// Default: Sunday at 02:00 UTC (cron format: minute hour day-of-month month day-of-week)
const DEFAULT_VACUUM_SCHEDULE_CRON = '0 2 * * 0';

@Injectable()
export class VacuumJob implements OnModuleInit {
  private readonly logger = new Logger(VacuumJob.name);
  private queue: Queue;
  private worker: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly vacuumService: VacuumService,
  ) {
    const connection = getBullMQConnection();
    this.queue = new Queue(QUEUE_NAME, { connection });
    this.worker = new Worker(
      QUEUE_NAME,
      async (_job: Job) => {
        await this.vacuumService.runWeeklyVacuum();
        await this.vacuumService.monitorTableBloat();
      },
      { connection },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`[vacuum-job] failed job ${job?.id}: ${err.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    const scheduleCron =
      this.config.get<string>('VACUUM_SCHEDULE_CRON') || DEFAULT_VACUUM_SCHEDULE_CRON;

    // Remove stale repeatable job before re-registering
    const repeatables = await this.queue.getRepeatableJobs();
    for (const r of repeatables) {
      if (r.key === REPEATABLE_JOB_KEY || r.name === JOB_NAME) {
        await this.queue.removeRepeatableByKey(r.key);
      }
    }

    await this.queue.add(
      JOB_NAME,
      {},
      {
        repeat: { pattern: scheduleCron, tz: 'UTC' },
        jobId: REPEATABLE_JOB_KEY,
      },
    );

    this.logger.log(`[vacuum-job] scheduled with cron pattern: ${scheduleCron}`);
  }
}
