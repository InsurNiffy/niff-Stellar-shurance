/**
 * @jest-environment jsdom
 *
 * Tests for settings page section anchors (#1124):
 *  - Each section has a stable anchor ID
 *  - Visiting /settings#<id> scrolls to and highlights the correct section
 *  - Visiting without a hash starts at the top with no highlight
 */

import React from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'

// ── Mock wallet / auth ──────────────────────────────────────────────────────
const mockWallet = {
  disconnect: jest.fn(),
  setAppNetwork: jest.fn(),
  address: null as string | null,
}
jest.mock('@/features/wallet', () => ({
  useWallet: () => mockWallet,
  LAST_WALLET_ID_STORAGE_KEY: 'niffyinsure:lastWalletId',
}))
jest.mock('@/hooks/use-wallet', () => ({ useWallet: () => mockWallet }))
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ jwt: null }), setJwt: jest.fn() }))
jest.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', setTheme: jest.fn() }),
}))
jest.mock('@/hooks/use-onboarding-tour', () => ({
  useOnboardingTour: () => ({ startTour: jest.fn() }),
  resetTour: jest.fn(),
}))
jest.mock('@/hooks/use-settings', () => ({
  useSettings: () => ({
    settings: {
      network: 'testnet',
      customRpcUrl: null,
      rpcWarningAcknowledged: false,
      telemetryEnabled: false,
      displayCurrency: 'XLM',
      notifications: {
        renewalRemindersEnabled: true,
        claimUpdatesEnabled: true,
        voteRemindersEnabled: true,
      },
      _v: 2,
    },
    update: jest.fn(),
    reset: jest.fn(),
  }),
  useNotificationSync: () => ({ syncing: false, syncError: null }),
}))
jest.mock('@/lib/network-manifest', () => ({ getContracts: jest.fn(() => []) }))
jest.mock('@/features/wallet/constants', () => ({
  SETTINGS_NETWORK_SECTION_ID: 'settings-network',
}))
jest.mock('@/config/env', () => ({
  env: {
    NEXT_PUBLIC_API_URL: 'http://localhost:3001',
    NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    NEXT_PUBLIC_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    NEXT_PUBLIC_NETWORK: 'testnet',
  },
}))
jest.mock('@/lib/settings-store', () => {
  const actual = jest.requireActual('@/lib/settings-store')
  return { ...actual, validateManifestReachable: jest.fn().mockResolvedValue({ reachable: true }) }
})

import { SettingsPanel } from '../settings/settings-panel'

const SECTION_IDS = ['appearance', 'display-currency', 'notifications', 'settings-network', 'onboarding-tour', 'advanced']

describe('SettingsPanel — section anchors (#1124)', () => {
  let scrollIntoViewMock: jest.Mock

  beforeEach(() => {
    scrollIntoViewMock = jest.fn()
    // Provide scrollIntoView on all elements
    Element.prototype.scrollIntoView = scrollIntoViewMock
    // Clear location hash
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { hash: '' },
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('renders each section with a stable anchor id', () => {
    render(<SettingsPanel />)

    for (const id of SECTION_IDS) {
      expect(document.getElementById(id)).not.toBeNull()
    }
  })

  it('scrolls to the section matching the URL hash on load', async () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { hash: '#notifications' },
    })

    render(<SettingsPanel />)

    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalled()
    })
  })

  it('highlights the target section temporarily then removes the highlight', async () => {
    jest.useFakeTimers()

    Object.defineProperty(window, 'location', {
      writable: true,
      value: { hash: '#appearance' },
    })

    render(<SettingsPanel />)

    await act(async () => {
      // After render, useEffect fires
    })

    const el = document.getElementById('appearance')!
    expect(el.classList.contains('ring-2')).toBe(true)

    act(() => jest.advanceTimersByTime(2100))
    expect(el.classList.contains('ring-2')).toBe(false)

    jest.useRealTimers()
  })

  it('does not scroll or highlight when there is no hash', async () => {
    render(<SettingsPanel />)

    await act(async () => {})
    expect(scrollIntoViewMock).not.toHaveBeenCalled()
  })
})
