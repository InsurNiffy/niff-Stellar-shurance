/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'

import {
  NetworkMismatchOverlayView,
  buildMismatchCopy,
} from '@/features/wallet/components/NetworkMismatchModal'

jest.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

describe('buildMismatchCopy', () => {
  it('describes standard mismatch', () => {
    const copy = buildMismatchCopy('mainnet', { status: 'ok', mappedNetwork: 'testnet' })
    expect(copy.announcement).toContain('Mainnet')
    expect(copy.announcement).toContain('Testnet')
  })

  it('describes unsupported wallet passphrase', () => {
    const copy = buildMismatchCopy('mainnet', { status: 'ok', mappedNetwork: null })
    expect(copy.title).toContain('Unsupported')
    expect(copy.announcement).toMatch(/unsupported|expect/i)
  })
})

describe('NetworkMismatchOverlayView', () => {
  const base = {
    appNetwork: 'mainnet' as const,
    resolution: { status: 'ok' as const, mappedNetwork: 'testnet' as const },
    switchNetworkHref: '/settings#settings-network',
  }

  it('does not render alert dialog when closed', () => {
    const { container } = render(<NetworkMismatchOverlayView open={false} {...base} />)
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('renders blocking overlay and Switch Network when open', () => {
    render(<NetworkMismatchOverlayView open {...base} />)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /switch network/i })).toHaveAttribute(
      'href',
      '/settings#settings-network',
    )
  })

  it('dismisses alert dialog when open flips to false', async () => {
    const { rerender } = render(<NetworkMismatchOverlayView open {...base} />)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    rerender(<NetworkMismatchOverlayView open={false} {...base} />)
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })

  it('exposes assertive live region for screen reader announcement', () => {
    render(<NetworkMismatchOverlayView open {...base} />)
    const live = document.querySelector('[aria-live="assertive"]')
    expect(live).toBeTruthy()
    expect(live?.textContent?.length).toBeGreaterThan(10)
  })
})
