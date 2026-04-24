/**
 * Tests for useNetworkStatus hook and NetworkBanner component.
 * Uses Jest + @testing-library/react (jsdom environment).
 */
import { act, renderHook } from '@testing-library/react'
import { render, screen } from '@testing-library/react'
import { onlineManager } from '@tanstack/react-query'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fireOnline() {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  window.dispatchEvent(new Event('online'))
}

function fireOffline() {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
  window.dispatchEvent(new Event('offline'))
}

// ── useNetworkStatus ──────────────────────────────────────────────────────────

describe('useNetworkStatus', () => {
  beforeEach(() => {
    // Start each test online
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })

  it('returns isOnline=true when navigator.onLine is true', async () => {
    const { useNetworkStatus } = await import('@/hooks/use-network-status')
    const { result } = renderHook(() => useNetworkStatus())
    expect(result.current.isOnline).toBe(true)
  })

  it('transitions to isOnline=false on offline event', async () => {
    const { useNetworkStatus } = await import('@/hooks/use-network-status')
    const { result } = renderHook(() => useNetworkStatus())

    act(() => { fireOffline() })

    expect(result.current.isOnline).toBe(false)
  })

  it('transitions back to isOnline=true on online event', async () => {
    const { useNetworkStatus } = await import('@/hooks/use-network-status')
    const { result } = renderHook(() => useNetworkStatus())

    act(() => { fireOffline() })
    expect(result.current.isOnline).toBe(false)

    act(() => { fireOnline() })
    expect(result.current.isOnline).toBe(true)
  })

  it('calls onlineManager.setOnline(false) when going offline', async () => {
    const spy = jest.spyOn(onlineManager, 'setOnline')
    const { useNetworkStatus } = await import('@/hooks/use-network-status')
    renderHook(() => useNetworkStatus())

    act(() => { fireOffline() })

    expect(spy).toHaveBeenCalledWith(false)
    spy.mockRestore()
  })

  it('calls onlineManager.setOnline(true) when coming back online', async () => {
    const spy = jest.spyOn(onlineManager, 'setOnline')
    const { useNetworkStatus } = await import('@/hooks/use-network-status')
    renderHook(() => useNetworkStatus())

    act(() => { fireOffline() })
    act(() => { fireOnline() })

    expect(spy).toHaveBeenCalledWith(true)
    spy.mockRestore()
  })
})

// ── NetworkBanner ─────────────────────────────────────────────────────────────

describe('NetworkBanner', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })

  it('renders nothing when online', async () => {
    const { NetworkBanner } = await import('@/components/ui/network-banner')
    const { container } = render(<NetworkBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the banner when offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const { NetworkBanner } = await import('@/components/ui/network-banner')
    render(<NetworkBanner />)
    expect(screen.getByTestId('network-banner')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('hides the banner after coming back online', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const { NetworkBanner } = await import('@/components/ui/network-banner')
    render(<NetworkBanner />)
    expect(screen.getByTestId('network-banner')).toBeInTheDocument()

    act(() => { fireOnline() })

    expect(screen.queryByTestId('network-banner')).toBeNull()
  })
})
