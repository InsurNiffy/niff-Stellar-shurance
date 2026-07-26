/**
 * @jest-environment jsdom
 */
import { render, act } from '@testing-library/react'
import React from 'react'

import { SessionTimeoutModal } from '../SessionTimeoutModal'
import { toast } from '@/components/ui/use-toast'

const mockWallet = { connectionStatus: 'connected' as string, disconnect: jest.fn() }
const mockRouter = { push: jest.fn() }

jest.mock('@/features/wallet', () => ({
  useWallet: () => mockWallet,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}))

jest.mock('@/lib/hooks/useAuth', () => ({
  setJwt: jest.fn(),
}))

const mockDismiss = jest.fn()
const mockIdleTimeout = { showWarning: false, stayLoggedIn: jest.fn() }

jest.mock('@/hooks/use-idle-timeout', () => ({
  useIdleTimeout: () => mockIdleTimeout,
}))

jest.mock('@/components/ui/use-toast', () => ({
  toast: jest.fn(() => ({ dismiss: mockDismiss, id: 'toast-1', update: jest.fn() })),
}))

describe('SessionTimeoutModal (wallet session expiry warning)', () => {
  beforeEach(() => {
    mockWallet.connectionStatus = 'connected'
    mockWallet.disconnect.mockReset()
    mockRouter.push.mockReset()
    mockIdleTimeout.showWarning = false
    mockIdleTimeout.stayLoggedIn.mockReset()
    mockDismiss.mockReset()
    ;(toast as jest.Mock).mockClear()
  })

  it('renders nothing in the DOM (toast-only UI)', () => {
    const { container } = render(<SessionTimeoutModal />)
    expect(container).toBeEmptyDOMElement()
  })

  it('does not show a warning toast before the idle warning threshold', () => {
    render(<SessionTimeoutModal />)
    expect(toast).not.toHaveBeenCalled()
  })

  it('shows a warning toast when idle warning threshold is reached', () => {
    mockIdleTimeout.showWarning = true
    render(<SessionTimeoutModal />)
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'warning',
        title: 'Wallet session expiring soon',
        duration: 0,
      }),
    )
  })

  it('extends the session when stay connected is chosen', () => {
    mockIdleTimeout.showWarning = true
    render(<SessionTimeoutModal />)

    const toastArgs = (toast as jest.Mock).mock.calls[0][0]
    const actionEl = toastArgs.action as React.ReactElement
    act(() => {
      actionEl.props.onClick()
    })

    expect(mockIdleTimeout.stayLoggedIn).toHaveBeenCalledTimes(1)
    expect(mockDismiss).toHaveBeenCalled()
  })

  it('does not warn when the wallet is disconnected', () => {
    mockWallet.connectionStatus = 'disconnected'
    mockIdleTimeout.showWarning = true
    render(<SessionTimeoutModal />)
    expect(toast).not.toHaveBeenCalled()
  })
})
