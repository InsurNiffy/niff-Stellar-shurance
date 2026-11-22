import { apiFetch } from './fetch'
import { getConfig } from '@/config/env'

export interface ChannelPreferences {
  email: boolean
  push: boolean
  inApp: boolean
}

export interface NotificationPreferences {
  renewalRemindersEnabled: boolean
  claimUpdatesEnabled: boolean
  voteRemindersEnabled: boolean
  /** Notify the claimant when their appeal round resolves (#1345). */
  appealOutcomeEnabled: boolean
  channels: {
    renewalReminders: ChannelPreferences
    claimUpdates: ChannelPreferences
    voteReminders: ChannelPreferences
    /** Per-channel preferences for appeal outcome notifications (#1345). */
    appealOutcome: ChannelPreferences
  }
}

interface ProfileResponse {
  notificationPreferences?: NotificationPreferences | null
}

/** Preferences are stored on the authenticated wallet's profile (GET /profile). */
export async function getNotificationPreferences(
  walletAddress: string,
  jwt: string,
): Promise<NotificationPreferences> {
  const { apiUrl } = getConfig()
  const profile = await apiFetch<ProfileResponse>(`${apiUrl}/api/profile`, {
    headers: { Authorization: `Bearer ${jwt}` },
  })
  return (profile.notificationPreferences ?? {}) as NotificationPreferences
}

/** Persist preferences via PATCH /profile. */
export async function patchNotificationPreferences(
  walletAddress: string,
  prefs: Partial<NotificationPreferences>,
  jwt: string,
): Promise<void> {
  const { apiUrl } = getConfig()
  await apiFetch<void>(`${apiUrl}/api/profile`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ notificationPreferences: prefs }),
  })
}
