/**
 * Tests for settings-store persistence and use-settings sync hook.
 */

import { loadSettings, saveSettings, type AppSettings } from '@/lib/settings-store'

const STORAGE_KEY = 'niffyinsur-settings-v2'

beforeEach(() => {
  localStorage.clear()
})

describe('loadSettings', () => {
  it('returns defaults when localStorage is empty', () => {
    const s = loadSettings()
    expect(s.network).toBe('testnet')
    expect(s.displayCurrency).toBe('XLM')
    expect(s.notifications.renewalRemindersEnabled).toBe(true)
    expect(s.notifications.claimUpdatesEnabled).toBe(true)
  })

  it('returns defaults when schema version mismatches', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ _v: 0, network: 'public' }))
    const s = loadSettings()
    expect(s.network).toBe('testnet') // default, not 'public'
  })

  it('returns defaults when JSON is malformed', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json')
    const s = loadSettings()
    expect(s.network).toBe('testnet')
  })

  it('merges stored values over defaults', () => {
    const stored: AppSettings = {
      _v: 2,
      network: 'public',
      customRpcUrl: null,
      rpcWarningAcknowledged: false,
      telemetryEnabled: false,
      displayCurrency: 'EUR',
      notifications: { renewalRemindersEnabled: false, claimUpdatesEnabled: true },
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    const s = loadSettings()
    expect(s.network).toBe('public')
    expect(s.displayCurrency).toBe('EUR')
    expect(s.notifications.renewalRemindersEnabled).toBe(false)
  })
})

describe('saveSettings', () => {
  it('persists settings to localStorage', () => {
    const s = loadSettings()
    saveSettings({ ...s, displayCurrency: 'USD' })
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.displayCurrency).toBe('USD')
    expect(parsed._v).toBe(2)
  })

  it('round-trips notification preferences', () => {
    const s = loadSettings()
    saveSettings({
      ...s,
      notifications: { renewalRemindersEnabled: false, claimUpdatesEnabled: false },
    })
    const loaded = loadSettings()
    expect(loaded.notifications.renewalRemindersEnabled).toBe(false)
    expect(loaded.notifications.claimUpdatesEnabled).toBe(false)
  })
})
