import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import { getBullMQConnection } from '../redis/client';
import { SupportTicketAutocloseService } from './support-ticket-autoclose.service';

const QUEUE_NAME = 'support-ticket-autoclose';
const JOB_NAME = 'autoclose-inactive-tickets';
const REPEATABLE_JOB_KEY = 'support-ticket-autoclose-scheduled';

// Default: daily at 03:00 UTC
const DEFAULT_AUTOCLOSE_SCHEDULE_CRON = '0 3 * * *';

@Injectable()
export class SupportTicketAutocloseJob implements OnModuleInit {
  private readonly logger = new Logger(SupportTicketAutocloseJob.name);
  private queue: Queue;
  private worker: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly autocloseService: SupportTicketAutocloseService,
  ) {
    const connection = getBullMQConnection();
    this.queue = new Queue(QUEUE_NAME, { connection });
    this.worker = new Worker(
      QUEUE_NAME,
      async (_job: Job) => {
        await this.autocloseService.autoCloseInactiveTickets();
      },
      { connection },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`[support-ticket-autoclose-job] failed job ${job?.id}: ${err.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    const scheduleCron =
      this.config.get<string>('SUPPORT_TICKET_AUTOCLOSE_CRON') || DEFAULT_AUTOCLOSE_SCHEDULE_CRON;

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

    this.logger.log(`[support-ticket-autoclose-job] scheduled with cron pattern: ${scheduleCron}`);
  }
}
