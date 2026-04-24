import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { WalletAddress } from '../components/WalletAddress'
import { truncateAddress } from '../utils/truncateAddress'
import { stellarExpertAccountUrl } from '../utils/stellarExpert'

const ADDR = 'GBCPNZ6S7RK5N4BX6HBXBCX7P5QNBOJZFGDWBZBXCLK5T6KHWOPTLR3I'

// ── truncateAddress ───────────────────────────────────────────────────────────

describe('truncateAddress', () => {
  it('truncates to first 4 and last 4 chars with ellipsis', () => {
    expect(truncateAddress(ADDR, 4)).toBe('GBCP...R3I')
  })

  it('returns the address unchanged when shorter than 2*chars+3', () => {
    expect(truncateAddress('GABC', 4)).toBe('GABC')
  })

  it('uses default chars=5 when not specified', () => {
    expect(truncateAddress(ADDR)).toBe('GBCPN...R3I')
  })
})

// ── stellarExpertAccountUrl ───────────────────────────────────────────────────

describe('stellarExpertAccountUrl', () => {
  it('generates testnet URL', () => {
    expect(stellarExpertAccountUrl(ADDR, 'testnet')).toBe(
      `https://stellar.expert/explorer/testnet/account/${ADDR}`,
    )
  })

  it('generates mainnet URL using "public" network slug', () => {
    expect(stellarExpertAccountUrl(ADDR, 'mainnet')).toBe(
      `https://stellar.expert/explorer/public/account/${ADDR}`,
    )
  })

  it('generates futurenet URL', () => {
    expect(stellarExpertAccountUrl(ADDR, 'futurenet')).toBe(
      `https://stellar.expert/explorer/futurenet/account/${ADDR}`,
    )
  })
})

// ── WalletAddress component ───────────────────────────────────────────────────

describe('WalletAddress', () => {
  it('renders truncated address with full address in title attribute', () => {
    render(<WalletAddress address={ADDR} network="testnet" />)
    const span = screen.getByTitle(ADDR)
    expect(span).toBeInTheDocument()
    expect(span.textContent).toBe('GBCP...R3I')
  })

  it('shows copy button by default and hides it when showCopy=false', () => {
    const { rerender } = render(<WalletAddress address={ADDR} />)
    expect(screen.getByRole('button', { name: /copy address/i })).toBeInTheDocument()

    rerender(<WalletAddress address={ADDR} showCopy={false} />)
    expect(screen.queryByRole('button', { name: /copy address/i })).not.toBeInTheDocument()
  })

  it('shows "Copied!" feedback after clicking copy', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
    })

    render(<WalletAddress address={ADDR} />)
    const btn = screen.getByRole('button', { name: /copy address/i })

    await act(async () => {
      fireEvent.click(btn)
    })

    expect(await screen.findByRole('button', { name: /copied!/i })).toBeInTheDocument()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(ADDR)
  })

  it('resets copy feedback after 2 seconds', async () => {
    jest.useFakeTimers()
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
    })

    render(<WalletAddress address={ADDR} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /copy address/i }))
    })

    expect(screen.getByRole('button', { name: /copied!/i })).toBeInTheDocument()

    act(() => jest.advanceTimersByTime(2000))
    expect(screen.getByRole('button', { name: /copy address/i })).toBeInTheDocument()

    jest.useRealTimers()
  })

  it('renders explorer link pointing to correct network when showExplorer=true', () => {
    render(<WalletAddress address={ADDR} network="mainnet" showExplorer />)
    const link = screen.getByRole('link', { name: /stellar expert/i })
    expect(link).toHaveAttribute(
      'href',
      `https://stellar.expert/explorer/public/account/${ADDR}`,
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('does not render explorer link when showExplorer=false (default)', () => {
    render(<WalletAddress address={ADDR} network="testnet" />)
    expect(screen.queryByRole('link', { name: /stellar expert/i })).not.toBeInTheDocument()
  })

  it('handles clipboard failure silently', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
    })

    render(<WalletAddress address={ADDR} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /copy address/i }))
    })

    // Should not throw and button should remain in "copy" state
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /copy address/i })).toBeInTheDocument(),
    )
  })
})
