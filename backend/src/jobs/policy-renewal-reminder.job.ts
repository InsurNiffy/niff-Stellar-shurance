import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { Policy } from '../policies/policy.entity';
import { NotificationPreference } from '../notifications/notification-preference.entity';
import { NotificationsService } from '../notifications/notifications.service';

export const POLICY_RENEWAL_REMINDER_QUEUE = 'policy-renewal-reminder';
export const POLICY_RENEWAL_REMINDER_JOB = 'scan-policy-renewals';

/** Reminder windows expressed in ledger terms (days before expiry). */
export const DEFAULT_REMINDER_WINDOWS_DAYS = [7, 1];

const PAGE_SIZE = 200;

@Injectable()
@Processor(POLICY_RENEWAL_REMINDER_QUEUE)
export class PolicyRenewalReminderJob extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(PolicyRenewalReminderJob.name);

  constructor(
    @InjectRepository(Policy)
    private readonly policyRepo: Repository<Policy>,
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepo: Repository<NotificationPreference>,
    @InjectQueue(POLICY_RENEWAL_REMINDER_QUEUE)
    private readonly reminderQueue: Queue,
    private readonly notificationsService: NotificationsService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const windows = this.getReminderWindows();
    // Run once per day; each run evaluates every configured window.
    await this.reminderQueue.add(
      POLICY_RENEWAL_REMINDER_JOB,
      { windows },
      {
        repeat: { pattern: process.env.POLICY_REMINDER_CRON ?? '0 6 * * *' },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }

  async process(job: Job<{ windows?: number[] }>): Promise<{ enqueued: number }> {
    const windows = job.data?.windows?.length ? job.data.windows : this.getReminderWindows();
    let enqueued = 0;

    for (const windowDays of windows) {
      enqueued += await this.scanWindow(windowDays);
    }

    this.logger.log(`Policy renewal reminder scan complete: ${enqueued} notification(s) enqueued`);
    return { enqueued };
  }

  private getReminderWindows(): number[] {
    const raw = process.env.POLICY_REMINDER_WINDOWS_DAYS;
    if (!raw) {
      return DEFAULT_REMINDER_WINDOWS_DAYS;
    }
    const parsed = raw
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value) && value > 0);
    return parsed.length ? parsed : DEFAULT_REMINDER_WINDOWS_DAYS;
  }

  private async scanWindow(windowDays: number): Promise<number> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
    const reminderType = `renewal_${windowDays}d`;
    let enqueued = 0;
    let offset = 0;

    // Paginate over indexed (status, expiry_date) range to keep memory bounded.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const policies = await this.policyRepo
        .createQueryBuilder('policy')
        .where('policy.status = :status', { status: 'active' })
        .andWhere('policy.expiryDate > :now', { now })
        .andWhere('policy.expiryDate <= :windowEnd', { windowEnd })
        .orderBy('policy.expiryDate', 'ASC')
        .addOrderBy('policy.id', 'ASC')
        .skip(offset)
        .take(PAGE_SIZE)
        .getMany();

      if (!policies.length) {
        break;
      }

      for (const policy of policies) {
        if (await this.isOptedIn(policy)) {
          const created = await this.notificationsService.enqueueRenewalReminder({
            policyId: policy.id,
            reminderType,
            windowDays,
            expiryDate: policy.expiryDate,
          });
          if (created) {
            enqueued += 1;
          }
        }
      }

      if (policies.length < PAGE_SIZE) {
        break;
      }
      offset += PAGE_SIZE;
    }

    return enqueued;
  }

  private async isOptedIn(policy: Policy): Promise<boolean> {
    const preference = await this.preferenceRepo.findOne({
      where: { policyId: policy.id, type: 'renewal_reminder' },
    });
    // Absent preference defaults to opted-in; explicit opt-out blocks delivery.
    return preference ? preference.enabled : true;
  }
}
