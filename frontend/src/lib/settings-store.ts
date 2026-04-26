/**
 * Settings store — persists user preferences in localStorage.
 * Schema version is bumped whenever the shape changes; old data is discarded.
 * NEVER stores secrets, private keys, or seed phrases.
 */

import type { Network } from './network-manifest'

const SCHEMA_VERSION = 2
const STORAGE_KEY = 'niffyinsur-settings-v2'

export interface AppSettings {
  /** Schema version — increment when shape changes */
  _v: number
  /** Active Stellar network */
  network: Network
  /** Custom Soroban RPC URL; null = use public default */
  customRpcUrl: string | null
  /** Whether the user has acknowledged the custom-RPC phishing warning */
  rpcWarningAcknowledged: boolean
  /** Opt-in to privacy-safe telemetry for settings changes */
  telemetryEnabled: boolean
  /** Display currency preference (XLM, USD, EUR) */
  displayCurrency: 'XLM' | 'USD' | 'EUR'
  /** Notification preferences */
  notifications: {
    renewalRemindersEnabled: boolean
    claimUpdatesEnabled: boolean
  }
}

export const PUBLIC_RPC: Record<Network, string> = {
  testnet: 'https://soroban-testnet.stellar.org',
  public: 'https://soroban-mainnet.stellar.org',
}

export const STATUS_PAGES: Record<Network, string> = {
  testnet: 'https://status.stellar.org',
  public: 'https://status.stellar.org',
}

const DEFAULTS: AppSettings = {
  _v: SCHEMA_VERSION,
  network: 'testnet',
  customRpcUrl: null,
  rpcWarningAcknowledged: false,
  telemetryEnabled: false,
  displayCurrency: 'XLM',
  notifications: {
    renewalRemindersEnabled: true,
    claimUpdatesEnabled: true,
  },
}

export function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return { ...DEFAULTS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as AppSettings
    // Discard stale schema
    if (parsed._v !== SCHEMA_VERSION) return { ...DEFAULTS }
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, _v: SCHEMA_VERSION }))
}

/** Validate a custom RPC URL — must be https and a valid URL */
export function validateRpcUrl(url: string): string | null {
  if (!url.trim()) return 'URL is required'
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return 'Only HTTPS endpoints are allowed'
    return null
  } catch {
    return 'Enter a valid URL (e.g. https://rpc.example.com)'
  }
}
