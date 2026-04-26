'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  loadSettings,
  saveSettings,
  type AppSettings,
} from '@/lib/settings-store'
import { patchNotificationPreferences } from '@/lib/api/notifications'

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings)

  // Sync to localStorage on every change
  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  const update = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value }
      if (prev.telemetryEnabled && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('niffyinsur:settings_change', {
            detail: { key, network: next.network },
          })
        )
      }
      return next
    })
  }, [])

  const reset = useCallback(() => {
    localStorage.removeItem('niffyinsur-settings-v2')
    setSettings(loadSettings())
  }, [])

  return { settings, update, reset }
}

/**
 * Syncs notification preferences to the backend whenever they change.
 * Requires a connected wallet address and a valid JWT.
 * Silently no-ops when either is absent.
 */
export function useNotificationSync(
  prefs: AppSettings['notifications'],
  walletAddress: string | null,
  jwt: string | null,
) {
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  // Track the last successfully synced value to avoid redundant requests
  const lastSynced = useRef<AppSettings['notifications'] | null>(null)

  useEffect(() => {
    if (!walletAddress || !jwt) return
    // Skip if nothing changed since last sync
    if (
      lastSynced.current &&
      lastSynced.current.renewalRemindersEnabled === prefs.renewalRemindersEnabled &&
      lastSynced.current.claimUpdatesEnabled === prefs.claimUpdatesEnabled
    ) return

    let cancelled = false
    setSyncing(true)
    setSyncError(null)

    patchNotificationPreferences(walletAddress, prefs, jwt)
      .then(() => {
        if (!cancelled) {
          lastSynced.current = prefs
          setSyncing(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSyncError(err instanceof Error ? err.message : 'Sync failed')
          setSyncing(false)
        }
      })

    return () => { cancelled = true }
  }, [prefs, walletAddress, jwt])

  return { syncing, syncError }
}
