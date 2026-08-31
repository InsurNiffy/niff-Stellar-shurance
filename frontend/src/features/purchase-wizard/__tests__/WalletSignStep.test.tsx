/**
 * @jest-environment jsdom
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const mockWalletState = {
  address: 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGH',
  connectionStatus: 'connected' as 'disconnected' | 'connecting' | 'connected' | 'error',
  signTransaction: jest.fn(),
}
jest.mock('@/features/wallet', () => ({
  useWallet: () => mockWalletState,
  WalletConnectButton: () => <button>Connect Wallet</button>,
}))

const mockCheckAllowance = jest.fn()
const mockInitiatePolicy = jest.fn()
const mockSubmitSignedPolicy = jest.fn()
jest.mock('@/features/purchase-wizard/api', () => ({
  initiatePolicy: (...args: unknown[]) => mockInitiatePolicy(...args),
  submitSignedPolicy: (...args: unknown[]) => mockSubmitSignedPolicy(...args),
  checkAllowance: (...args: unknown[]) => mockCheckAllowance(...args),
  buildApprovalTransaction: jest.fn(),
  submitApprovalTransaction: jest.fn(),
}))

const mockTxStatus = { status: null as string | null, error: null, explorerUrl: null }
jest.mock('@/hooks/useTransactionStatus', () => ({
  useTransactionStatus: () => mockTxStatus,
}))

jest.mock('@/config/env', () => ({
  getConfig: () => ({ apiUrl: 'http://localhost:3001', explorerBase: 'https://stellar.expert', network: 'testnet', contractId: 'CTEST' }),
}))

import { WalletSignStep } from '../WalletSignStep'
import type { QuoteFormData, QuoteResponse } from '@/lib/schemas/quote'

const COVERAGE: QuoteFormData = {
  policy_type: 'Auto',
  region: 'Low',
  coverage_tier: 'Basic',
  age: 30,
  risk_score: 5,
}

const QUOTE: QuoteResponse = {
  premiumStroops: '10000000',
  premiumXlm: '1.0',
  minResourceFee: '100',
  protocolFeeBps: 500,
  source: 'simulation',
  inputs: { policy_type: 'Auto', region: 'Low', age: 30, risk_score: 5 },
}

const onBack = jest.fn()
const onSuccess = jest.fn()

function renderStep() {
  return render(
    <WalletSignStep
      coverageData={COVERAGE}
      quote={QUOTE}
      quoteExpiresAt={Date.now() + 300_000}
      onBack={onBack}
      onSuccess={onSuccess}
    />,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockWalletState.address = 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGH'
  mockWalletState.connectionStatus = 'connected'
  mockCheckAllowance.mockResolvedValue({ sufficient: true, currentAllowance: '0', contractAddress: 'C1', tokenAddress: 'C2' })
  mockInitiatePolicy.mockResolvedValue({ transactionXdr: 'xdr123', quoteId: 'q1' })
  mockSubmitSignedPolicy.mockResolvedValue({ policyId: 'pol-1', txHash: 'txhash123' })
})

describe('WalletSignStep — signature retry', () => {
  it('shows a clear message and retry option when the signature is rejected', async () => {
    mockWalletState.signTransaction.mockRejectedValue(new Error('User rejected the request'))
    renderStep()

    fireEvent.click(screen.getByRole('button', { name: /sign & submit/i }))

    await waitFor(() => {
      expect(screen.getByText(/rejected the transaction/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('shows a clear message and retry option when the signature request times out', async () => {
    mockWalletState.signTransaction.mockRejectedValue(new Error('Request timed out'))
    renderStep()

    fireEvent.click(screen.getByRole('button', { name: /sign & submit/i }))

    await waitFor(() => {
      expect(screen.getByText(/timed out/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('successfully completes on retry after an initial rejection, without leaving this step', async () => {
    mockWalletState.signTransaction.mockRejectedValueOnce(new Error('User rejected the request'))
    mockWalletState.signTransaction.mockResolvedValueOnce('signed-xdr')
    renderStep()

    fireEvent.click(screen.getByRole('button', { name: /sign & submit/i }))
    await waitFor(() => screen.getByRole('button', { name: /try again/i }))

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /sign & submit/i }))

    await waitFor(() => {
      expect(mockSubmitSignedPolicy).toHaveBeenCalledWith('xdr123', 'signed-xdr', 'q1')
    })
    expect(onBack).not.toHaveBeenCalled()
  })
})
