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
  channels: {
    renewalReminders: ChannelPreferences
    claimUpdates: ChannelPreferences
    voteReminders: ChannelPreferences
  }
}

export async function getNotificationPreferences(
  walletAddress: string,
  jwt: string,
): Promise<NotificationPreferences> {
  const { apiUrl } = getConfig()
  return apiFetch<NotificationPreferences>(`${apiUrl}/notifications/preferences/${walletAddress}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  })
}

export async function patchNotificationPreferences(
  walletAddress: string,
  prefs: Partial<NotificationPreferences>,
  jwt: string,
): Promise<void> {
  const { apiUrl } = getConfig()
  await apiFetch<void>(`${apiUrl}/notifications/preferences/${walletAddress}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(prefs),
  })
}
