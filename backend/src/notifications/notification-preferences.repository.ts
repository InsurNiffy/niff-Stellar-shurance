import { Injectable } from '@nestjs/common';
import { NotificationPreferenceRecord } from './notification-preference.types';

export const NOTIFICATION_PREFERENCES_REPOSITORY = Symbol(
  'NOTIFICATION_PREFERENCES_REPOSITORY',
);

export interface NotificationPreferencesRepository {
  findByUserId(userId: string): Promise<NotificationPreferenceRecord | null>;
  upsert(record: NotificationPreferenceRecord): Promise<NotificationPreferenceRecord>;
}

@Injectable()
export class InMemoryNotificationPreferencesRepository
  implements NotificationPreferencesRepository
{
  private readonly records = new Map<string, NotificationPreferenceRecord>();

  async findByUserId(userId: string): Promise<NotificationPreferenceRecord | null> {
    return this.records.get(userId) ?? null;
  }

  async upsert(
    record: NotificationPreferenceRecord,
  ): Promise<NotificationPreferenceRecord> {
    this.records.set(record.userId, record);
    return record;
  }
}
