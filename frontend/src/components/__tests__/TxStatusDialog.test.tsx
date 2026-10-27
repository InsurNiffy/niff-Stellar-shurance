/**
 * @jest-environment jsdom
 */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TxStatusDialog } from '../TxStatusDialog'

describe('TxStatusDialog', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: jest.fn() })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('shows transaction hash on Stellar Expert and vibrates on success', () => {
    render(<TxStatusDialog state="success" open transactionHash="TX123" onClose={jest.fn()} />)

    const link = screen.getByRole('link', { name: /stellar expert/i })
    expect(link).toHaveAttribute('href', expect.stringContaining('/tx/TX123'))
    expect(navigator.vibrate).toHaveBeenCalled()
  })

  it('automatically closes confirmed success after ten seconds', () => {
    const onClose = jest.fn()
    render(<TxStatusDialog state="success" open onClose={onClose} />)

    act(() => jest.advanceTimersByTime(10_000))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape and renders XDR details for errors', async () => {
    const onClose = jest.fn()
    render(<TxStatusDialog state="error" open error="Transaction rejected" xdrError="AAAABASE64XDR" onClose={onClose} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Transaction rejected')
    expect(screen.getByText(/AAAABASE64XDR/i)).toBeInTheDocument()
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
