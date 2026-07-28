/**
 * @jest-environment jsdom
 */
import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'

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

jest.mock('@/lib/formatTokenAmount', () => ({
  formatTokenAmount: (v: string) => v,
}))

import { QuoteReviewStep } from '../QuoteReviewStep'
import type { QuoteFormData } from '@/lib/schemas/quote'

const COVERAGE: QuoteFormData = {
  policy_type: 'Auto',
  region: 'Low',
  coverage_tier: 'Basic',
  age: 30,
  risk_score: 5,
}

const MOCK_QUOTE = {
  premiumStroops: '10000000',
  premiumXlm: '1.0',
  minResourceFee: '100',
  protocolFeeBps: 500,
  source: 'simulation' as const,
  inputs: { policy_type: 'Auto', region: 'Low', age: 30, risk_score: 5 },
}

const onNext = jest.fn()
const onBack = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('QuoteReviewStep — quote expiry countdown', () => {
  it('shows the full remaining window for a freshly generated quote', async () => {
    mockGeneratePremium.mockResolvedValue(MOCK_QUOTE)
    render(<QuoteReviewStep coverageData={COVERAGE} cachedQuote={null} cachedQuoteExpiresAt={null} onNext={onNext} onBack={onBack} />)

    await waitFor(() => {
      expect(screen.getByText(/quote valid for 5:00/i)).toBeInTheDocument()
    })
  })

  it('counts down as time passes without a page refresh', async () => {
    mockGeneratePremium.mockResolvedValue(MOCK_QUOTE)
    render(<QuoteReviewStep coverageData={COVERAGE} cachedQuote={null} cachedQuoteExpiresAt={null} onNext={onNext} onBack={onBack} />)

    await waitFor(() => {
      expect(screen.getByText(/quote valid for 5:00/i)).toBeInTheDocument()
    })

    act(() => {
      jest.advanceTimersByTime(60_000)
    })

    await waitFor(() => {
      expect(screen.getByText(/quote valid for 4:00/i)).toBeInTheDocument()
    })
  })

  it('disables confirmation and prompts a re-quote once the countdown reaches zero', async () => {
    const expiresAt = Date.now() + 5000
    render(
      <QuoteReviewStep
        coverageData={COVERAGE}
        cachedQuote={MOCK_QUOTE}
        cachedQuoteExpiresAt={expiresAt}
        onNext={onNext}
        onBack={onBack}
      />,
    )

    expect(screen.getByRole('button', { name: /proceed to sign/i })).toBeInTheDocument()

    act(() => {
      jest.advanceTimersByTime(6000)
    })

    await waitFor(() => {
      expect(screen.getByText(/quote expired/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /proceed to sign/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /regenerate quote/i })).toBeInTheDocument()
  })
})
