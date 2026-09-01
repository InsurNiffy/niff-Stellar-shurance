import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import { getBullMQConnection } from '../redis/client';
import { StagingDataSyncService } from './staging-data-sync.service';

const QUEUE_NAME = 'staging-data-sync';
const JOB_NAME = 'sync-anonymized-data';
const REPEATABLE_JOB_KEY = 'staging-data-sync-scheduled';

// Default: daily at 02:00 UTC
const DEFAULT_SYNC_SCHEDULE_CRON = '0 2 * * *';

/**
 * Scheduled job for syncing an anonymized representative subset of production data into staging.
 *
 * ⚠️ COMPLIANCE NOTICE: This job ships disabled. Before enabling:
 * 1. Review ANONYMIZATION_RULES.md and confirm all sensitive fields are properly classified.
 * 2. Confirm a compliance/privacy authority has approved the field list.
 * 3. Set STAGING_DATA_SYNC_ENABLED=true to enable scheduling.
 * 4. Set STAGING_DATA_SYNC_CRON to customize the refresh schedule (default: 0 2 * * * — daily at 02:00 UTC).
 *
 * The job can be tested via dry-run without touching production data:
 * - Use HTTP endpoint POST /admin/staging-sync/dry-run (if exposed) or invoke service directly.
 *
 * See backend/docs/staging-sync-schedule.md for full documentation.
 */
@Injectable()
export class StagingDataSyncJob implements OnModuleInit {
  private readonly logger = new Logger(StagingDataSyncJob.name);
  private queue: Queue;
  private worker: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly syncService: StagingDataSyncService,
  ) {
    const connection = getBullMQConnection();
    this.queue = new Queue(QUEUE_NAME, { connection });
    this.worker = new Worker(
      QUEUE_NAME,
      async (_job: Job) => {
        const isDryRun = _job.data?.dryRun ?? false;
        if (isDryRun) {
          return await this.syncService.dryRun();
        }
        return await this.syncService.sync();
      },
      { connection },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `[staging-data-sync-job] failed job ${job?.id}: ${err.message}`,
      );
    });
  }

  async onModuleInit(): Promise<void> {
    const isEnabled = this.config.get<boolean>('STAGING_DATA_SYNC_ENABLED', false);

    if (!isEnabled) {
      this.logger.warn(
        '[staging-data-sync-job] Job is DISABLED. Set STAGING_DATA_SYNC_ENABLED=true to enable. See ANONYMIZATION_RULES.md for compliance review requirements.',
      );
      return;
    }

    const scheduleCron =
      this.config.get<string>('STAGING_DATA_SYNC_CRON') || DEFAULT_SYNC_SCHEDULE_CRON;

    // Remove stale repeatable job before re-registering
    const repeatables = await this.queue.getRepeatableJobs();
    for (const r of repeatables) {
      if (r.key === REPEATABLE_JOB_KEY || r.name === JOB_NAME) {
        await this.queue.removeRepeatableByKey(r.key);
      }
    }

    await this.queue.add(
      JOB_NAME,
      { dryRun: false },
      {
        repeat: { pattern: scheduleCron, tz: 'UTC' },
        jobId: REPEATABLE_JOB_KEY,
      },
    );

    this.logger.log(
      `[staging-data-sync-job] scheduled with cron pattern: ${scheduleCron}. Review ANONYMIZATION_RULES.md for compliance status.`,
    );
  }

  async triggerDryRun(): Promise<any> {
    this.logger.log('[staging-data-sync-job] Triggering manual dry-run...');
    const job = await this.queue.add(JOB_NAME, { dryRun: true });
    return job;
  }

  async triggerSync(): Promise<any> {
    this.logger.warn(
      '[staging-data-sync-job] Manual sync triggered. Ensure compliance review is complete before running against production.',
    );
    const job = await this.queue.add(JOB_NAME, { dryRun: false });
    return job;
  }
}
