import { apiFetch } from './fetch'
import { getConfig } from '@/config/env'

export interface NotificationPreferences {
  renewalRemindersEnabled: boolean
  claimUpdatesEnabled: boolean
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
