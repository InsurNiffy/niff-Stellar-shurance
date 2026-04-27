export const NOTIFICATION_TYPES = ["renewal_reminder", "claim_update"] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationPreferenceKey =
  | "renewalRemindersEnabled"
  | "claimUpdatesEnabled";

export interface NotificationPreferences {
  renewalRemindersEnabled: boolean;
  claimUpdatesEnabled: boolean;
}

export interface NotificationPreferenceRecord {
  userId: string;
  renewalRemindersEnabled: boolean | null;
  claimUpdatesEnabled: boolean | null;
}

export type NotificationPreferenceUpdate = Partial<NotificationPreferences>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  renewalRemindersEnabled: true,
  claimUpdatesEnabled: true,
};

export const NOTIFICATION_TYPE_TO_PREFERENCE_KEY: Record<
  NotificationType,
  NotificationPreferenceKey
> = {
  renewal_reminder: "renewalRemindersEnabled",
  claim_update: "claimUpdatesEnabled",
};
