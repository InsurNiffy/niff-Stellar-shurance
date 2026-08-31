/**
 * @jest-environment jsdom
 */

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'

import DashboardPage from '../page'
import { useWallet } from '@/hooks/use-wallet'
import { fetchPolicies } from '@/features/policies/api'

jest.mock('@/hooks/use-wallet')
jest.mock('@/features/policies/api')
jest.mock('@/components/dashboard/ProtocolStatsWidget', () => ({
  ProtocolStatsWidget: () => <div data-testid="protocol-stats-widget" />,
}))

const mockUseWallet = useWallet as jest.MockedFunction<typeof useWallet>
const mockFetchPolicies = fetchPolicies as jest.MockedFunction<typeof fetchPolicies>

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  jest.resetAllMocks()
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ claims: [], page: 1, totalPages: 0, totalCount: 0 }),
  }) as unknown as typeof fetch
})

describe('DashboardPage empty portfolio state', () => {
  it('shows the empty-portfolio guidance when the wallet has zero policies and zero claims', async () => {
    mockUseWallet.mockReturnValue({ address: 'GABC...WALLET' } as ReturnType<typeof useWallet>)
    mockFetchPolicies.mockResolvedValue({ data: [], next_cursor: null, total: 0 })

    renderWithClient(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('empty-dashboard-state')).toBeInTheDocument()
    })
    expect(screen.getByText(/get a quote/i)).toBeInTheDocument()
    expect(screen.getByText(/learn how coverage works/i)).toBeInTheDocument()
  })

  it('shows the normal populated dashboard when the wallet has at least one policy', async () => {
    mockUseWallet.mockReturnValue({ address: 'GABC...WALLET' } as ReturnType<typeof useWallet>)
    mockFetchPolicies.mockResolvedValue({
      data: [{ id: 'policy-1' }] as unknown as Awaited<ReturnType<typeof fetchPolicies>>['data'],
      next_cursor: null,
      total: 1,
    })

    renderWithClient(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByTestId('protocol-stats-widget')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('empty-dashboard-state')).not.toBeInTheDocument()
  })
})
