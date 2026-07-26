/**
 * @jest-environment jsdom
 */

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ClaimVotePanel } from '../claim-vote-panel'
import type { Claim, Eligibility } from '@/lib/schemas/vote'
import { useWallet } from '@/features/wallet'
import { useLatestLedger } from '@/hooks/use-latest-ledger'
import { fetchClaim, fetchEligibility, simulateVote, submitVote } from '@/lib/api/vote'

jest.mock('@/features/wallet', () => ({
  __esModule: true,
  useWallet: jest.fn(),
}))

jest.mock('@/hooks/use-latest-ledger', () => ({
  __esModule: true,
  useLatestLedger: jest.fn(),
}))

jest.mock('@/lib/api/vote', () => ({
  __esModule: true,
  fetchClaim: jest.fn(),
  fetchEligibility: jest.fn(),
  simulateVote: jest.fn(),
  submitVote: jest.fn(),
  checkAppealStatus: jest.fn().mockResolvedValue(false),
  simulateAppeal: jest.fn(),
  submitAppeal: jest.fn(),
  explorerUrl: jest.fn((hash: string) => `https://stellar.explorer/${hash}`),
  VoteAPIError: class VoteAPIError extends Error {},
  getVoteErrorMessage: jest.fn(),
  getAppealErrorMessage: jest.fn(),
}))

const mockUseWallet = useWallet as jest.MockedFunction<typeof useWallet>
const mockUseLatestLedger = useLatestLedger as jest.MockedFunction<typeof useLatestLedger>
const mockFetchClaim = fetchClaim as jest.MockedFunction<typeof fetchClaim>
const mockFetchEligibility = fetchEligibility as jest.MockedFunction<typeof fetchEligibility>
const mockSimulateVote = simulateVote as jest.MockedFunction<typeof simulateVote>
const mockSubmitVote = submitVote as jest.MockedFunction<typeof submitVote>

const VENUS_WALLET = 'GABCD1234ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234'

const claimFixture: Claim = {
  claim_id: 'CLAIM-123',
  policy_id: 'POLICY-456',
  claimant: VENUS_WALLET,
  amount: '50000000',
  details: 'Test claim details',
  evidence: [{ url: 'https://example.com/evidence.jpg', hash: 'hash-abc' }],
  status: 'Pending',
  voting_deadline_ledger: 150,
  approve_votes: 12,
  reject_votes: 8,
  filed_at: 100,
  total_voters: 20,
}

function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('ClaimVotePanel', () => {
  const mockSignTransaction = jest.fn().mockResolvedValue('signed-xdr')

  beforeEach(() => {
    jest.clearAllMocks()
    mockUseLatestLedger.mockReturnValue(140)
    mockUseWallet.mockReturnValue({
      address: VENUS_WALLET,
      signTransaction: mockSignTransaction,
    } as any)
    mockFetchClaim.mockResolvedValue(claimFixture)
    mockFetchEligibility.mockResolvedValue({ eligible: true, priorVote: null } as Eligibility)
    mockSimulateVote.mockResolvedValue(null)
    mockSubmitVote.mockResolvedValue({
      transactionHash: 'TXHASH-1',
      status: 'Pending',
      approve_votes: 13,
      reject_votes: 8,
    })
  })

  it('hides approve and reject actions when wallet is not eligible', async () => {
    mockFetchEligibility.mockResolvedValue({ eligible: false, reason: 'Not in the eligible voter set', priorVote: null } as Eligibility)

    renderWithQueryClient(<ClaimVotePanel claimId="CLAIM-123" />)

    await waitFor(() => expect(mockFetchClaim).toHaveBeenCalledWith('CLAIM-123'))
    await waitFor(() => expect(mockFetchEligibility).toHaveBeenCalledWith('CLAIM-123', VENUS_WALLET))

    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('claim-vote-unavailable')).toHaveTextContent('Not in the eligible voter set')
  })

  it('shows confirmation modal with vote summary and irreversibility warning before signing', async () => {
    renderWithQueryClient(<ClaimVotePanel claimId="CLAIM-123" />)

    await waitFor(() => expect(mockFetchClaim).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument())

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /approve/i }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/confirm approval vote/i)).toBeInTheDocument()
    expect(screen.getByText(/this action is irreversible/i)).toBeInTheDocument()
    expect(screen.getByText('CLAIM-123')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /sign & approve/i }))

    await waitFor(() => expect(mockSignTransaction).toHaveBeenCalledWith('vote:CLAIM-123:Approve'))
    await waitFor(() => expect(mockSubmitVote).toHaveBeenCalledWith('CLAIM-123', VENUS_WALLET, 'Approve', 'signed-xdr'))
    expect(await screen.findByText(/vote confirmed on-chain/i)).toBeInTheDocument()
  })

  it('disables voting controls after a successful vote', async () => {
    renderWithQueryClient(<ClaimVotePanel claimId="CLAIM-123" />)

    await waitFor(() => expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument())

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /approve/i }))
    await user.click(await screen.findByRole('button', { name: /sign & approve/i }))

    await waitFor(() => expect(mockSubmitVote).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument())
    expect(screen.getByText(/vote confirmed on-chain/i)).toBeInTheDocument()
  })

  it('hides voting controls when the voting deadline has passed', async () => {
    mockUseLatestLedger.mockReturnValue(200)
    renderWithQueryClient(<ClaimVotePanel claimId="CLAIM-123" />)

    await waitFor(() => expect(mockFetchClaim).toHaveBeenCalled())
    expect(await screen.findByTestId('claim-vote-unavailable')).toHaveTextContent(
      'The voting window for this claim has closed',
    )
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })
})
