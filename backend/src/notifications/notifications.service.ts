import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_TYPE_TO_PREFERENCE_KEY,
  NotificationPreferenceRecord,
  NotificationPreferences,
  NotificationPreferenceUpdate,
  NotificationType,
} from "./notification-preference.types";
import { NotificationPreferencesRepository as NotificationPreferencesRepositoryContract } from "./notification-preferences.repository";

export class NotificationsService {
  constructor(
    private readonly preferencesRepository: NotificationPreferencesRepositoryContract,
  ) {}

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const storedPreferences = await this.preferencesRepository.findByUserId(userId);
    return this.resolvePreferences(storedPreferences);
  }

  async updatePreferences(
    userId: string,
    updates: NotificationPreferenceUpdate,
  ): Promise<NotificationPreferences> {
    const currentRecord = await this.preferencesRepository.findByUserId(userId);
    const resolvedPreferences = this.resolvePreferences(currentRecord);

    const nextPreferences: NotificationPreferences = {
      renewalRemindersEnabled:
        updates.renewalRemindersEnabled ?? resolvedPreferences.renewalRemindersEnabled,
      claimUpdatesEnabled:
        updates.claimUpdatesEnabled ?? resolvedPreferences.claimUpdatesEnabled,
    };

    await this.preferencesRepository.upsert({
      userId,
      renewalRemindersEnabled: nextPreferences.renewalRemindersEnabled,
      claimUpdatesEnabled: nextPreferences.claimUpdatesEnabled,
    });

    return nextPreferences;
  }

  async shouldSendNotification(
    userId: string,
    notificationType: NotificationType,
  ): Promise<boolean> {
    const preferences = await this.getPreferences(userId);
    return preferences[NOTIFICATION_TYPE_TO_PREFERENCE_KEY[notificationType]];
  }

  private resolvePreferences(
    record: NotificationPreferenceRecord | null,
  ): NotificationPreferences {
    return {
      renewalRemindersEnabled:
        record?.renewalRemindersEnabled ??
        DEFAULT_NOTIFICATION_PREFERENCES.renewalRemindersEnabled,
      claimUpdatesEnabled:
        record?.claimUpdatesEnabled ??
        DEFAULT_NOTIFICATION_PREFERENCES.claimUpdatesEnabled,
    };
  }
}
