import { NotificationPreferenceRecord } from "./notification-preference.types";

export interface NotificationPreferencesRepository {
  findByUserId(userId: string): Promise<NotificationPreferenceRecord | null>;
  upsert(record: NotificationPreferenceRecord): Promise<NotificationPreferenceRecord>;
}

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
