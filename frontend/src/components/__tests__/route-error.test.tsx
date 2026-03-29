/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

import { RouteError } from '@/components/route-error'

const logRouteSegmentError = jest.fn()

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

jest.mock('@/lib/observability', () => ({
  logRouteSegmentError: (...args: unknown[]) => logRouteSegmentError(...args),
}))

describe('RouteError', () => {
  beforeEach(() => {
    logRouteSegmentError.mockClear()
  })

  describe('production UI', () => {
    const origEnv = process.env.NODE_ENV
    beforeAll(() => {
      process.env.NODE_ENV = 'production'
    })
    afterAll(() => {
      process.env.NODE_ENV = origEnv
    })

    it('renders contextual copy without stack traces in the main UI', () => {
      const err = new Error('internal detail') as Error & { digest?: string }
      err.digest = 'abc123'
      const reset = jest.fn()

      render(<RouteError error={err} reset={reset} area="Claims Board" segment="claims" />)

      expect(screen.getByRole('alert')).toHaveTextContent(/Claims Board unavailable/)
      expect(screen.getByText(/Support reference/i)).toBeInTheDocument()
      expect(screen.queryByText(/internal detail/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Technical details/i)).not.toBeInTheDocument()
    })
  })

  it('calls reset when Try again is activated', () => {
    const err = new Error('x') as Error & { digest?: string }
    const reset = jest.fn()

    render(<RouteError error={err} reset={reset} area="Policies" segment="policies" />)

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('links to the dashboard', () => {
    const err = new Error('x') as Error & { digest?: string }
    render(<RouteError error={err} reset={jest.fn()} area="Admin" segment="admin" />)

    expect(screen.getByRole('link', { name: /go to dashboard/i })).toHaveAttribute('href', '/dashboard')
  })

  it('logs anonymized segment metadata via observability', () => {
    const err = new Error('secret') as Error & { digest?: string }
    err.name = 'ChunkLoadError'
    err.digest = 'digest-1'

    render(<RouteError error={err} reset={jest.fn()} area="Claims Board" segment="claims" />)

    expect(logRouteSegmentError).toHaveBeenCalledWith({
      segment: 'claims',
      error: err,
    })
  })
})
