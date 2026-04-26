/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

import { PolicyDetailClient } from '../PolicyDetailClient'
import type { PolicyDto } from '../../api'

const mockPolicy: PolicyDto = {
  holder: 'GTEST123',
  policy_id: 1,
  policy_type: 'Auto',
  region: 'Medium',
  is_active: true,
  coverage_summary: {
    coverage_amount: '10000000000',
    premium_amount: '1000000000',
  },
  expiry_countdown: {
    ledgers_remaining: 100000,
    avg_ledger_close_seconds: 5,
  },
  beneficiary: null,
  claims: [],
}

jest.mock('@/features/wallet', () => ({
  useWallet: () => ({
    connected: false,
    address: null,
  }),
}))

jest.mock('@/config/env', () => ({
  getConfig: () => ({ apiUrl: 'http://localhost:3001' }),
}))

jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}))

describe('PolicyDetailClient', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  })

  it('renders coverage summary correctly', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PolicyDetailClient initialPolicy={mockPolicy} policyId="1" />
      </QueryClientProvider>
    )

    expect(screen.getByText('Policy #1')).toBeInTheDocument()
    expect(screen.getByText('Auto')).toBeInTheDocument()
    expect(screen.getByText('Medium')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('displays expiry countdown', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PolicyDetailClient initialPolicy={mockPolicy} policyId="1" />
      </QueryClientProvider>
    )

    expect(screen.getByText(/ledgers remaining/i)).toBeInTheDocument()
  })

  it('shows empty state when no claims', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PolicyDetailClient initialPolicy={mockPolicy} policyId="1" />
      </QueryClientProvider>
    )

    expect(screen.getByText('No claims filed for this policy.')).toBeInTheDocument()
  })

  it('renders linked claims list', () => {
    const policyWithClaims: PolicyDto = {
      ...mockPolicy,
      claims: [
        {
          claim_id: 101,
          amount: '5000000000',
          status: 'Processing',
          approve_votes: 5,
          reject_votes: 2,
          _link: '/claims/101',
        },
      ],
    }

    render(
      <QueryClientProvider client={queryClient}>
        <PolicyDetailClient initialPolicy={policyWithClaims} policyId="1" />
      </QueryClientProvider>
    )

    expect(screen.getByText('101')).toBeInTheDocument()
    expect(screen.getByText('Processing')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('does not show renewal CTA for unauthenticated users', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PolicyDetailClient initialPolicy={mockPolicy} policyId="1" />
      </QueryClientProvider>
    )

    expect(screen.queryByText('Renew Policy')).not.toBeInTheDocument()
  })

  it('shows beneficiary warning when different from connected wallet', () => {
    jest.resetModules()
    jest.mock('@/features/wallet', () => ({
      useWallet: () => ({
        connected: true,
        address: 'GDIFFERENT',
      }),
    }))

    const policyWithBeneficiary: PolicyDto = {
      ...mockPolicy,
      beneficiary: 'GBENEFICIARY',
    }

    render(
      <QueryClientProvider client={queryClient}>
        <PolicyDetailClient initialPolicy={policyWithBeneficiary} policyId="1" />
      </QueryClientProvider>
    )

    expect(screen.getByText(/payout destination differs/i)).toBeInTheDocument()
  })

  it('displays expired status correctly', () => {
    const expiredPolicy: PolicyDto = {
      ...mockPolicy,
      expiry_countdown: {
        ledgers_remaining: 0,
        avg_ledger_close_seconds: 5,
      },
    }

    render(
      <QueryClientProvider client={queryClient}>
        <PolicyDetailClient initialPolicy={expiredPolicy} policyId="1" />
      </QueryClientProvider>
    )

    expect(screen.getByText('Policy expired')).toBeInTheDocument()
  })
})
