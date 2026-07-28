/**
 * @jest-environment jsdom
 *
 * Integration tests for the PurchaseWizard.
 * All external dependencies are mocked; tests are deterministic and CI-safe.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockPush = jest.fn()
let mockSearchParams = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}))

const mockWalletState = {
  address: null as string | null,
  connectionStatus: 'disconnected' as 'disconnected' | 'connecting' | 'connected' | 'error',
  signTransaction: jest.fn(),
}
jest.mock('@/features/wallet', () => ({
  useWallet: () => mockWalletState,
  WalletConnectButton: () => <button>Connect Wallet</button>,
}))

const mockGeneratePremium = jest.fn()
jest.mock('@/lib/api/quote', () => ({
  generatePremium: (...args: unknown[]) => mockGeneratePremium(...args),
  QuoteError: class QuoteError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
      this.name = 'QuoteError'
    }
  },
  getQuoteErrorMessage: (e: { message: string }) => e.message,
  QUOTE_TTL_SECONDS: 300,
}))

const mockInitiatePolicy = jest.fn()
const mockSubmitSignedPolicy = jest.fn()
jest.mock('@/features/purchase-wizard/api', () => ({
  initiatePolicy: (...args: unknown[]) => mockInitiatePolicy(...args),
  submitSignedPolicy: (...args: unknown[]) => mockSubmitSignedPolicy(...args),
}))

const mockTxStatus = { status: null as string | null, error: null, explorerUrl: null }
jest.mock('@/hooks/useTransactionStatus', () => ({
  useTransactionStatus: () => mockTxStatus,
}))

jest.mock('@/config/env', () => ({
  getConfig: () => ({ apiUrl: 'http://localhost:3001', explorerBase: 'https://stellar.expert', network: 'testnet' }),
}))

jest.mock('@/lib/formatTokenAmount', () => ({
  formatTokenAmount: (v: string) => v,
}))

// Minimal localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { store = {} },
  }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// ── Helpers ──────────────────────────────────────────────────────────────────

import { PurchaseWizard } from '../PurchaseWizard'

const MOCK_QUOTE = {
  premiumStroops: '10000000',
  premiumXlm: '1.0',
  minResourceFee: '100',
  source: 'simulation' as const,
  inputs: { policy_type: 'Auto', region: 'Low', age: 30, risk_score: 5 },
}

function renderWizard() {
  return render(<PurchaseWizard />)
}

async function fillStep1AndSubmit() {
  fireEvent.change(screen.getByLabelText(/policy type/i), { target: { value: 'Auto' } })
  fireEvent.change(screen.getByLabelText(/region risk tier/i), { target: { value: 'Low' } })
  fireEvent.change(screen.getByLabelText(/coverage tier/i), { target: { value: 'Basic' } })
  fireEvent.change(screen.getByLabelText(/your age/i), { target: { value: '30' } })
  fireEvent.change(screen.getByLabelText(/risk score/i), { target: { value: '5' } })
  fireEvent.click(screen.getByRole('button', { name: /get quote/i }))
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  localStorageMock.clear()
  mockSearchParams = new URLSearchParams()
  mockWalletState.address = null
  mockWalletState.connectionStatus = 'disconnected'
  mockWalletState.signTransaction.mockReset()
  mockTxStatus.status = null
  mockTxStatus.error = null
  mockTxStatus.explorerUrl = null
})

describe('PurchaseWizard — Step 1: Coverage Details', () => {
  it('renders step 1 on initial load', () => {
    renderWizard()
    expect(screen.getByLabelText(/policy type/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/region risk tier/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/coverage tier/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/your age/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/risk score/i)).toBeInTheDocument()
  })

  it('shows validation errors when submitting empty form', async () => {
    renderWizard()
    fireEvent.click(screen.getByRole('button', { name: /get quote/i }))
    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    })
  })

  it('validates age range', async () => {
    renderWizard()
    fireEvent.change(screen.getByLabelText(/policy type/i), { target: { value: 'Auto' } })
    fireEvent.change(screen.getByLabelText(/region risk tier/i), { target: { value: 'Low' } })
    fireEvent.change(screen.getByLabelText(/coverage tier/i), { target: { value: 'Basic' } })
    fireEvent.change(screen.getByLabelText(/your age/i), { target: { value: '200' } })
    fireEvent.change(screen.getByLabelText(/risk score/i), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /get quote/i }))
    await waitFor(() => {
      expect(screen.getByText(/age must be at most 120/i)).toBeInTheDocument()
    })
  })

  it('advances to step 2 on valid submission', async () => {
    mockGeneratePremium.mockResolvedValue(MOCK_QUOTE)
    renderWizard()
    await fillStep1AndSubmit()
    await waitFor(() => {
      expect(screen.getByText(/quote review/i)).toBeInTheDocument()
    })
  })

  it('persists draft to localStorage on field change', async () => {
    renderWizard()
    fireEvent.change(screen.getByLabelText(/policy type/i), { target: { value: 'Health' } })
    await waitFor(() => {
      const raw = localStorageMock.getItem('niffyinsur-draft-purchase-wizard')
      expect(raw).not.toBeNull()
      const parsed = JSON.parse(raw!)
      expect(parsed.data.coverageData.policy_type).toBe('Health')
    })
  })
})

describe('PurchaseWizard — Step 2: Quote Review', () => {
  it('shows loading state while fetching quote', async () => {
    mockGeneratePremium.mockImplementation(() => new Promise(() => {})) // never resolves
    renderWizard()
    await fillStep1AndSubmit()
    await waitFor(() => {
      expect(screen.getByRole('status', { name: /loading quote/i })).toBeInTheDocument()
    })
  })

  it('renders quote details after successful fetch', async () => {
    mockGeneratePremium.mockResolvedValue(MOCK_QUOTE)
    renderWizard()
    await fillStep1AndSubmit()
    await waitFor(() => {
      expect(screen.getByText('1.0 XLM')).toBeInTheDocument()
      expect(screen.getByText('10000000')).toBeInTheDocument() // stroops
      expect(screen.getByText('Live simulation')).toBeInTheDocument()
    })
  })

  it('shows error state and retry button on quote failure', async () => {
    mockGeneratePremium.mockRejectedValue(new Error('Network error'))
    renderWizard()
    await fillStep1AndSubmit()
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    })
  })

  it('retries quote fetch on retry click', async () => {
    mockGeneratePremium
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(MOCK_QUOTE)
    renderWizard()
    await fillStep1AndSubmit()
    await waitFor(() => screen.getByRole('button', { name: /retry/i }))
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => {
      expect(screen.getByText('1.0 XLM')).toBeInTheDocument()
    })
  })

  it('navigates back to step 1 on Back click', async () => {
    mockGeneratePremium.mockResolvedValue(MOCK_QUOTE)
    renderWizard()
    await fillStep1AndSubmit()
    await waitFor(() => screen.getByRole('button', { name: /back/i }))
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => {
      expect(screen.getByLabelText(/policy type/i)).toBeInTheDocument()
    })
  })

  it('advances to step 3 on Proceed to Sign click', async () => {
    mockGeneratePremium.mockResolvedValue(MOCK_QUOTE)
    renderWizard()
    await fillStep1AndSubmit()
    await waitFor(() => screen.getByRole('button', { name: /proceed to sign/i }))
    fireEvent.click(screen.getByRole('button', { name: /proceed to sign/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign & submit/i })).toBeInTheDocument()
    })
  })

  it('persists quote to draft when advancing to step 3', async () => {
    mockGeneratePremium.mockResolvedValue(MOCK_QUOTE)
    renderWizard()
    await fillStep1AndSubmit()
    await waitFor(() => screen.getByRole('button', { name: /proceed to sign/i }))
    fireEvent.click(screen.getByRole('button', { name: /proceed to sign/i }))
    await waitFor(() => {
      const raw = localStorageMock.getItem('niffyinsur-draft-purchase-wizard')
      const parsed = JSON.parse(raw!)
      expect(parsed.data.step).toBe(2)
      expect(parsed.data.quote.premiumXlm).toBe('1.0')
    })
  })
})

describe('PurchaseWizard — Step 3: Wallet Sign & Submit', () => {
  async function advanceToStep3() {
    mockGeneratePremium.mockResolvedValue(MOCK_QUOTE)
    renderWizard()
    await fillStep1AndSubmit()
    await waitFor(() => screen.getByRole('button', { name: /proceed to sign/i }))
    fireEvent.click(screen.getByRole('button', { name: /proceed to sign/i }))
    await waitFor(() => screen.getByRole('button', { name: /sign & submit/i }))
  }

  it('shows wallet connect prompt when disconnected', async () => {
    await advanceToStep3()
    expect(screen.getByText(/connect your wallet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /connect wallet/i })).toBeInTheDocument()
  })

  it('shows Sign & Submit button when wallet connected', async () => {
    mockWalletState.address = 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGH'
    mockWalletState.connectionStatus = 'connected'
    await advanceToStep3()
    expect(screen.getByRole('button', { name: /sign & submit/i })).toBeInTheDocument()
  })

  it('shows processing state during initiation', async () => {
    mockWalletState.address = 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGH'
    mockWalletState.connectionStatus = 'connected'
    mockInitiatePolicy.mockImplementation(() => new Promise(() => {}))
    await advanceToStep3()
    fireEvent.click(screen.getByRole('button', { name: /sign & submit/i }))
    await waitFor(() => {
      expect(screen.getByRole('status', { hidden: true })).toBeInTheDocument()
    })
  })

  it('shows signing state after initiation succeeds', async () => {
    mockWalletState.address = 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGH'
    mockWalletState.connectionStatus = 'connected'
    mockInitiatePolicy.mockResolvedValue({ transactionXdr: 'xdr123', quoteId: 'q1' })
    mockWalletState.signTransaction.mockImplementation(() => new Promise(() => {}))
    await advanceToStep3()
    fireEvent.click(screen.getByRole('button', { name: /sign & submit/i }))
    await waitFor(() => {
      expect(screen.getByText(/waiting for wallet signature/i)).toBeInTheDocument()
    })
  })

  it('handles wallet rejection gracefully', async () => {
    mockWalletState.address = 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGH'
    mockWalletState.connectionStatus = 'connected'
    mockInitiatePolicy.mockResolvedValue({ transactionXdr: 'xdr123', quoteId: 'q1' })
    mockWalletState.signTransaction.mockRejectedValue(new Error('User rejected the request'))
    await advanceToStep3()
    fireEvent.click(screen.getByRole('button', { name: /sign & submit/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText(/rejected the transaction/i)).toBeInTheDocument()
    })
    // Can retry after rejection
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('resets to idle state on Try Again click after rejection', async () => {
    mockWalletState.address = 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGH'
    mockWalletState.connectionStatus = 'connected'
    mockInitiatePolicy.mockResolvedValue({ transactionXdr: 'xdr123', quoteId: 'q1' })
    mockWalletState.signTransaction.mockRejectedValue(new Error('User rejected'))
    await advanceToStep3()
    fireEvent.click(screen.getByRole('button', { name: /sign & submit/i }))
    await waitFor(() => screen.getByRole('button', { name: /try again/i }))
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /sign & submit/i })).not.toBeDisabled()
    })
  })

  it('prevents duplicate submissions', async () => {
    mockWalletState.address = 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGH'
    mockWalletState.connectionStatus = 'connected'
    mockInitiatePolicy.mockImplementation(() => new Promise(() => {}))
    await advanceToStep3()
    const btn = screen.getByRole('button', { name: /sign & submit/i })
    fireEvent.click(btn)
    fireEvent.click(btn)
    await waitFor(() => {
      expect(mockInitiatePolicy).toHaveBeenCalledTimes(1)
    })
  })

  it('enters polling state after successful submission', async () => {
    mockWalletState.address = 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGH'
    mockWalletState.connectionStatus = 'connected'
    mockInitiatePolicy.mockResolvedValue({ transactionXdr: 'xdr123', quoteId: 'q1' })
    mockWalletState.signTransaction.mockResolvedValue('signed-xdr')
    mockSubmitSignedPolicy.mockResolvedValue({ policyId: 'pol-1', txHash: 'txhash123' })
    await advanceToStep3()
    fireEvent.click(screen.getByRole('button', { name: /sign & submit/i }))
    await waitFor(() => {
      expect(screen.getByText(/confirming on-chain/i)).toBeInTheDocument()
    })
  })

  it('redirects to policy page on SUCCESS polling status', async () => {
    mockWalletState.address = 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGH'
    mockWalletState.connectionStatus = 'connected'
    mockInitiatePolicy.mockResolvedValue({ transactionXdr: 'xdr123', quoteId: 'q1' })
    mockWalletState.signTransaction.mockResolvedValue('signed-xdr')
    mockSubmitSignedPolicy.mockResolvedValue({ policyId: 'pol-1', txHash: 'txhash123' })
    mockTxStatus.status = 'SUCCESS'

    await advanceToStep3()
    fireEvent.click(screen.getByRole('button', { name: /sign & submit/i }))
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/policies/pol-1')
    })
  })

  it('shows error on FAILED polling status', async () => {
    mockWalletState.address = 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGH'
    mockWalletState.connectionStatus = 'connected'
    mockInitiatePolicy.mockResolvedValue({ transactionXdr: 'xdr123', quoteId: 'q1' })
    mockWalletState.signTransaction.mockResolvedValue('signed-xdr')
    mockSubmitSignedPolicy.mockResolvedValue({ policyId: 'pol-1', txHash: 'txhash123' })
    mockTxStatus.status = 'FAILED'

    await advanceToStep3()
    fireEvent.click(screen.getByRole('button', { name: /sign & submit/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText(/transaction failed on-chain/i)).toBeInTheDocument()
    })
  })

  it('shows timeout error on NOT_FOUND_TIMEOUT polling status', async () => {
    mockWalletState.address = 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGH'
    mockWalletState.connectionStatus = 'connected'
    mockInitiatePolicy.mockResolvedValue({ transactionXdr: 'xdr123', quoteId: 'q1' })
    mockWalletState.signTransaction.mockResolvedValue('signed-xdr')
    mockSubmitSignedPolicy.mockResolvedValue({ policyId: 'pol-1', txHash: 'txhash123' })
    mockTxStatus.status = 'NOT_FOUND_TIMEOUT'

    await advanceToStep3()
    fireEvent.click(screen.getByRole('button', { name: /sign & submit/i }))
    await waitFor(() => {
      expect(screen.getByText(/not confirmed in time/i)).toBeInTheDocument()
    })
  })

  it('shows backend error on initiation failure', async () => {
    mockWalletState.address = 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGH'
    mockWalletState.connectionStatus = 'connected'
    mockInitiatePolicy.mockRejectedValue(new Error('Insufficient balance'))
    await advanceToStep3()
    fireEvent.click(screen.getByRole('button', { name: /sign & submit/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText(/insufficient balance/i)).toBeInTheDocument()
    })
  })

  it('navigates back to step 2 on Back click', async () => {
    mockWalletState.address = 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGH'
    mockWalletState.connectionStatus = 'connected'
    await advanceToStep3()
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => {
      expect(screen.getByText(/quote review/i)).toBeInTheDocument()
    })
  })
})

describe('PurchaseWizard — Draft Persistence', () => {
  it('restores draft from localStorage on mount', async () => {
    const draft = {
      _v: 1,
      _ts: Date.now(),
      data: {
        step: 0,
        coverageData: { policy_type: 'Health', region: 'High', coverage_tier: 'Premium', age: 45, risk_score: 7 },
        quote: null,
        quoteExpiresAt: null,
      },
    }
    localStorageMock.setItem('niffyinsur-draft-purchase-wizard', JSON.stringify(draft))
    renderWizard()
    await waitFor(() => {
      const select = screen.getByLabelText(/policy type/i) as HTMLSelectElement
      expect(select.value).toBe('Health')
    })
  })

  it('restores to step 2 when draft has step=1 and valid quote', async () => {
    const draft = {
      _v: 1,
      _ts: Date.now(),
      data: {
        step: 1,
        coverageData: { policy_type: 'Auto', region: 'Low', coverage_tier: 'Basic', age: 30, risk_score: 5 },
        quote: MOCK_QUOTE,
        quoteExpiresAt: Date.now() + 300000,
      },
    }
    localStorageMock.setItem('niffyinsur-draft-purchase-wizard', JSON.stringify(draft))
    mockGeneratePremium.mockResolvedValue(MOCK_QUOTE)
    renderWizard()
    await waitFor(() => {
      expect(screen.getByText(/quote review/i)).toBeInTheDocument()
    })
  })

  it('clears draft after successful policy creation', async () => {
    mockWalletState.address = 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGH'
    mockWalletState.connectionStatus = 'connected'
    mockGeneratePremium.mockResolvedValue(MOCK_QUOTE)
    mockInitiatePolicy.mockResolvedValue({ transactionXdr: 'xdr123', quoteId: 'q1' })
    mockWalletState.signTransaction.mockResolvedValue('signed-xdr')
    mockSubmitSignedPolicy.mockResolvedValue({ policyId: 'pol-1', txHash: 'txhash123' })
    mockTxStatus.status = 'SUCCESS'

    renderWizard()
    await fillStep1AndSubmit()
    await waitFor(() => screen.getByRole('button', { name: /proceed to sign/i }))
    fireEvent.click(screen.getByRole('button', { name: /proceed to sign/i }))
    await waitFor(() => screen.getByRole('button', { name: /sign & submit/i }))
    fireEvent.click(screen.getByRole('button', { name: /sign & submit/i }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/policies/pol-1')
    })
    expect(localStorageMock.getItem('niffyinsur-draft-purchase-wizard')).toBeNull()
  })

  it('ignores expired draft (TTL exceeded)', async () => {
    const draft = {
      _v: 1,
      _ts: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
      data: {
        step: 1,
        coverageData: { policy_type: 'Auto' },
        quote: MOCK_QUOTE,
        quoteExpiresAt: Date.now() + 300000,
      },
    }
    localStorageMock.setItem('niffyinsur-draft-purchase-wizard', JSON.stringify(draft))
    renderWizard()
    await waitFor(() => {
      // Should be on step 0, not step 1
      expect(screen.getByLabelText(/policy type/i)).toBeInTheDocument()
    })
  })

  it('prefills coverage details from a valid shared quote link', async () => {
    mockSearchParams = new URLSearchParams({
      policy_type: 'Health',
      region: 'High',
      coverage_tier: 'Premium',
      age: '45',
      risk_score: '7',
      premium_xlm: '2.5',
      premium_stroops: '25000000',
    })
    renderWizard()
    await waitFor(() => {
      const select = screen.getByLabelText(/policy type/i) as HTMLSelectElement
      expect(select.value).toBe('Health')
    })
    expect((screen.getByLabelText(/your age/i) as HTMLInputElement).value).toBe('45')
  })

  it('falls back to the normal blank start when the shared link is invalid', async () => {
    mockSearchParams = new URLSearchParams({
      policy_type: 'NotARealType',
      region: 'High',
      coverage_tier: 'Premium',
      age: '45',
      risk_score: '7',
    })
    renderWizard()
    await waitFor(() => {
      const select = screen.getByLabelText(/policy type/i) as HTMLSelectElement
      expect(select.value).toBe('')
    })
  })

  it('ignores draft with wrong schema version', async () => {
    const draft = {
      _v: 99, // wrong version
      _ts: Date.now(),
      data: {
        step: 2,
        coverageData: { policy_type: 'Auto' },
        quote: MOCK_QUOTE,
        quoteExpiresAt: Date.now() + 300000,
      },
    }
    localStorageMock.setItem('niffyinsur-draft-purchase-wizard', JSON.stringify(draft))
    renderWizard()
    await waitFor(() => {
      expect(screen.getByLabelText(/policy type/i)).toBeInTheDocument()
    })
  })
})

describe('PurchaseWizard — Accessibility', () => {
  it('step 1 form has accessible labels', () => {
    renderWizard()
    expect(screen.getByLabelText(/policy type/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/region risk tier/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/coverage tier/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/your age/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/risk score/i)).toBeInTheDocument()
  })

  it('validation errors use role=alert', async () => {
    renderWizard()
    fireEvent.click(screen.getByRole('button', { name: /get quote/i }))
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert')
      expect(alerts.length).toBeGreaterThan(0)
    })
  })

  it('loading state has role=status', async () => {
    mockGeneratePremium.mockImplementation(() => new Promise(() => {}))
    renderWizard()
    await fillStep1AndSubmit()
    await waitFor(() => {
      expect(screen.getByRole('status', { name: /loading quote/i })).toBeInTheDocument()
    })
  })
})

describe('PurchaseWizard — Navigation Guard', () => {
  it('registers beforeunload handler when wizard has entered data', async () => {
    const addSpy = jest.spyOn(window, 'addEventListener')
    renderWizard()
    fireEvent.change(screen.getByLabelText(/policy type/i), { target: { value: 'Auto' } })
    await waitFor(() => {
      expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
    })
    addSpy.mockRestore()
  })

  it('does not register beforeunload handler for empty wizard', () => {
    const addSpy = jest.spyOn(window, 'addEventListener')
    renderWizard()
    const beforeUnloadCalls = addSpy.mock.calls.filter(([event]) => event === 'beforeunload')
    expect(beforeUnloadCalls).toHaveLength(0)
    addSpy.mockRestore()
  })

  it('removes beforeunload handler after successful completion', async () => {
    const removeSpy = jest.spyOn(window, 'removeEventListener')
    mockWalletState.address = 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGH'
    mockWalletState.connectionStatus = 'connected'
    mockGeneratePremium.mockResolvedValue(MOCK_QUOTE)
    mockInitiatePolicy.mockResolvedValue({ transactionXdr: 'xdr123', quoteId: 'q1' })
    mockWalletState.signTransaction.mockResolvedValue('signed-xdr')
    mockSubmitSignedPolicy.mockResolvedValue({ policyId: 'pol-1', txHash: 'txhash123' })
    mockTxStatus.status = 'SUCCESS'

    renderWizard()
    await fillStep1AndSubmit()
    await waitFor(() => screen.getByRole('button', { name: /proceed to sign/i }))
    fireEvent.click(screen.getByRole('button', { name: /proceed to sign/i }))
    await waitFor(() => screen.getByRole('button', { name: /sign & submit/i }))
    fireEvent.click(screen.getByRole('button', { name: /sign & submit/i }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/policies/pol-1')
    })
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
    removeSpy.mockRestore()
  })
})
