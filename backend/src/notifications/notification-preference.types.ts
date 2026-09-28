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
  /** Per-event × channel routing, quiet hours and digest mode (#1483). */
  routing?: NotificationRoutingPreferences | null;
  /** Notification email — only delivered when `emailVerified` is true (#1483). */
  email?: string | null;
  emailVerified?: boolean;
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

// ── Per-event × channel routing, quiet hours and digest (#1483) ──────────────

export const NOTIFICATION_CHANNELS = ["email", "inApp"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Which channels a single event type is routed to. */
export interface EventChannelRouting {
  email: boolean;
  inApp: boolean;
}

/** Quiet hours window in HH:mm (local server time, UTC by default). */
export interface QuietHoursConfig {
  enabled: boolean;
  start: string;
  end: string;
}

/** Digest batching mode for claim updates. */
export type DigestMode = "off" | "daily" | "batch";

export interface NotificationRoutingPreferences {
  events: Record<NotificationType, EventChannelRouting>;
  quietHours: QuietHoursConfig;
  digestMode: DigestMode;
}

export const DEFAULT_CHANNEL_ROUTING: EventChannelRouting = {
  email: true,
  inApp: true,
};

export const DEFAULT_QUIET_HOURS: QuietHoursConfig = {
  enabled: false,
  start: "22:00",
  end: "07:00",
};

export const DEFAULT_DIGEST_MODE: DigestMode = "off";

export function defaultRoutingPreferences(): NotificationRoutingPreferences {
  return {
    events: Object.fromEntries(
      NOTIFICATION_TYPES.map((type) => [type, { ...DEFAULT_CHANNEL_ROUTING }]),
    ) as Record<NotificationType, EventChannelRouting>,
    quietHours: { ...DEFAULT_QUIET_HOURS },
    digestMode: DEFAULT_DIGEST_MODE,
  };
}

/** Merge stored routing over the defaults so unknown/missing keys never crash. */
export function resolveRoutingPreferences(
  stored: NotificationRoutingPreferences | null | undefined,
): NotificationRoutingPreferences {
  const defaults = defaultRoutingPreferences();
  if (!stored) return defaults;
  return {
    events: Object.fromEntries(
      NOTIFICATION_TYPES.map((type) => [
        type,
        { ...defaults.events[type], ...(stored.events?.[type] ?? {}) },
      ]),
    ) as Record<NotificationType, EventChannelRouting>,
    quietHours: { ...defaults.quietHours, ...(stored.quietHours ?? {}) },
    digestMode: stored.digestMode ?? defaults.digestMode,
  };
}
