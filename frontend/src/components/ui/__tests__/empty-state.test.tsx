/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

import { EmptyState } from '../empty-state'

// Mock useReducedMotion to avoid matchMedia issues in jsdom
jest.mock('@/lib/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => false,
}))

describe('EmptyState', () => {
  it('renders headline and description', () => {
    render(
      <EmptyState
        variant="policies"
        headline="No policies yet"
        description="Get a quote to start."
      />,
    )
    expect(screen.getByText('No policies yet')).toBeInTheDocument()
    expect(screen.getByText('Get a quote to start.')).toBeInTheDocument()
  })

  it('renders CTA link when ctaLabel and ctaHref are provided', () => {
    render(
      <EmptyState
        variant="policies"
        headline="No policies"
        description="Start here."
        ctaLabel="Get your first quote"
        ctaHref="/quote"
      />,
    )
    const link = screen.getByRole('link', { name: /get your first quote/i })
    expect(link).toHaveAttribute('href', '/quote')
  })

  it('does not render CTA when ctaLabel is omitted', () => {
    render(
      <EmptyState variant="claims" headline="No claims" description="Nothing here." />,
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders secondary action button and calls handler', () => {
    const handler = jest.fn()
    render(
      <EmptyState
        variant="transactions"
        headline="No transactions"
        description="Nothing yet."
        secondaryLabel="Refresh"
        onSecondaryClick={handler}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('renders all three illustration variants without crashing', () => {
    const { rerender } = render(
      <EmptyState variant="policies" headline="h" description="d" />,
    )
    rerender(<EmptyState variant="claims" headline="h" description="d" />)
    rerender(<EmptyState variant="transactions" headline="h" description="d" />)
    // No assertion needed — just verifying no render errors
  })

  it('has role=status for screen reader announcements', () => {
    render(<EmptyState variant="policies" headline="Empty" description="Nothing." />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
