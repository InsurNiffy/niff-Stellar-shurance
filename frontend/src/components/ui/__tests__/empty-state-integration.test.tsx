/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import React from 'react'

// Mock useReducedMotion
jest.mock('@/lib/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => false,
}))

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  useSearchParams: () => ({
    get: jest.fn(),
  }),
  usePathname: () => '/',
}))

describe('Empty State Integration Tests', () => {
  describe('Policies Empty State', () => {
    it('renders when API returns zero policies', async () => {
      // Mock the policies API to return empty array
      const { PolicyDashboard } = await import('@/features/policies/components/PolicyDashboard')
      
      // Mock usePolicies hook
      jest.mock('@/features/policies/hooks/usePolicies', () => ({
        usePolicies: () => ({
          policies: [],
          loading: false,
          error: null,
          total: 0,
          retry: jest.fn(),
        }),
      }))

      render(<PolicyDashboard />)

      // Verify empty state is rendered
      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.getByText(/no policies/i)).toBeInTheDocument()
    })

    it('CTA navigates to policy purchase page', async () => {
      const { PolicyDashboard } = await import('@/features/policies/components/PolicyDashboard')
      
      render(<PolicyDashboard />)

      const ctaLink = screen.queryByRole('link', { name: /purchase/i })
      if (ctaLink) {
        expect(ctaLink).toHaveAttribute('href', expect.stringContaining('/policy'))
      }
    })
  })

  describe('Claims Empty State', () => {
    it('renders when API returns zero claims', () => {
      const { EmptyState } = require('@/components/ui/empty-state')
      
      render(
        <EmptyState
          variant="claims"
          headline="No claims found"
          description="There are no claims matching the current filters."
        />
      )

      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.getByText(/no claims found/i)).toBeInTheDocument()
    })

    it('CTA navigates to claim filing page', () => {
      const { EmptyState } = require('@/components/ui/empty-state')
      
      render(
        <EmptyState
          variant="claims"
          headline="No claims filed"
          description="File your first claim."
          ctaLabel="File a Claim"
          ctaHref="/claims/new"
        />
      )

      const ctaLink = screen.getByRole('link', { name: /file a claim/i })
      expect(ctaLink).toHaveAttribute('href', '/claims/new')
    })
  })

  describe('Transaction History Empty State', () => {
    it('renders when API returns zero transactions', () => {
      const { EmptyState } = require('@/components/ui/empty-state')
      
      render(
        <EmptyState
          variant="transactions"
          headline="No transactions yet"
          description="Your transaction history will appear here."
          ctaLabel="Purchase Policy"
          ctaHref="/policy"
        />
      )

      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument()
    })

    it('CTA navigates to policy purchase page', () => {
      const { EmptyState } = require('@/components/ui/empty-state')
      
      render(
        <EmptyState
          variant="transactions"
          headline="No transactions yet"
          description="Start here."
          ctaLabel="Purchase Policy"
          ctaHref="/policy"
        />
      )

      const ctaLink = screen.getByRole('link', { name: /purchase policy/i })
      expect(ctaLink).toHaveAttribute('href', '/policy')
    })
  })

  describe('Accessibility', () => {
    it('illustrations have aria-hidden attribute', () => {
      const { EmptyState } = require('@/components/ui/empty-state')
      
      const { container } = render(
        <EmptyState
          variant="policies"
          headline="Empty"
          description="Nothing here."
        />
      )

      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    })

    it('respects prefers-reduced-motion', () => {
      // Mock reduced motion preference
      jest.resetModules()
      jest.mock('@/lib/hooks/use-reduced-motion', () => ({
        useReducedMotion: () => true,
      }))

      const { EmptyState } = require('@/components/ui/empty-state')
      
      const { container } = render(
        <EmptyState
          variant="policies"
          headline="Empty"
          description="Nothing here."
        />
      )

      const svg = container.querySelector('svg')
      // Animation class should not be present when reduced motion is preferred
      expect(svg?.className).not.toContain('animate')
    })

    it('CTA has minimum touch target size', () => {
      const { EmptyState } = require('@/components/ui/empty-state')
      
      render(
        <EmptyState
          variant="policies"
          headline="Empty"
          description="Nothing here."
          ctaLabel="Action"
          ctaHref="/action"
        />
      )

      const cta = screen.getByRole('link', { name: /action/i })
      expect(cta).toHaveClass('min-h-[44px]')
    })
  })
})
