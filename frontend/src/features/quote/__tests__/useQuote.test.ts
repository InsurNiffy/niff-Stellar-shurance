/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { useQuote, QUOTE_DEBOUNCE_MS } from '../useQuote'
import { fetchQuote } from '../api'
import type { QuoteResponse } from '@/lib/schemas/quote'

jest.mock('../api', () => ({
  fetchQuote: jest.fn(),
}))

const mockFetchQuote = fetchQuote as jest.MockedFunction<typeof fetchQuote>

import type { QuoteFormData } from '@/lib/schemas/quote'

type QuoteInputs = Required<
  Pick<QuoteFormData, 'policy_type' | 'region' | 'coverage_tier' | 'age' | 'risk_score'>
>

const baseInputs: QuoteInputs = {
  policy_type: 'Auto' as const,
  region: 'Medium' as const,
  coverage_tier: 'Standard' as const,
  age: 30,
  risk_score: 5,
}

function mockQuote(overrides: Partial<QuoteResponse> = {}): QuoteResponse {
  return {
    premiumStroops: '10000000',
    premiumXlm: '1.0',
    minResourceFee: '100',
    protocolFeeBps: 500,
    source: 'simulation',
    inputs: {
      policy_type: 'Auto',
      region: 'Medium',
      age: 30,
      risk_score: 5,
    },
    ...overrides,
  }
}

describe('useQuote debounce', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockFetchQuote.mockReset()
    mockFetchQuote.mockResolvedValue(mockQuote())
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('does not simulate until the debounce window elapses', async () => {
    const { rerender } = renderHook(
      ({ inputs }: { inputs: QuoteInputs }) => useQuote(inputs, QUOTE_DEBOUNCE_MS),
      { initialProps: { inputs: { ...baseInputs, coverage_tier: 'Basic' } } },
    )

    expect(mockFetchQuote).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(QUOTE_DEBOUNCE_MS - 1)
    })
    expect(mockFetchQuote).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(1)
    })

    await waitFor(() => expect(mockFetchQuote).toHaveBeenCalledTimes(1))
    expect(mockFetchQuote).toHaveBeenCalledWith(
      expect.objectContaining({ coverage_tier: 'Basic' }),
      expect.any(AbortSignal),
    )

    // silence unused rerender warning in this case
    void rerender
  })

  it('rapid successive coverage changes result in a single simulation for the final value', async () => {
    const { rerender } = renderHook(
      ({ inputs }: { inputs: QuoteInputs }) => useQuote(inputs, QUOTE_DEBOUNCE_MS),
      { initialProps: { inputs: { ...baseInputs, coverage_tier: 'Basic', age: 20 } } },
    )

    // Simulate rapid keystrokes / slider ticks before debounce fires.
    await act(async () => {
      rerender({ inputs: { ...baseInputs, coverage_tier: 'Standard', age: 21 } })
      jest.advanceTimersByTime(50)
      rerender({ inputs: { ...baseInputs, coverage_tier: 'Premium', age: 22 } })
      jest.advanceTimersByTime(50)
      rerender({ inputs: { ...baseInputs, coverage_tier: 'Premium', age: 35 } })
    })

    expect(mockFetchQuote).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(QUOTE_DEBOUNCE_MS)
    })

    await waitFor(() => expect(mockFetchQuote).toHaveBeenCalledTimes(1))
    expect(mockFetchQuote).toHaveBeenCalledWith(
      {
        policy_type: 'Auto',
        region: 'Medium',
        coverage_tier: 'Premium',
        age: 35,
        risk_score: 5,
      },
      expect.any(AbortSignal),
    )
  })

  it('a later settled value replaces an earlier pending simulation', async () => {
    mockFetchQuote
      .mockResolvedValueOnce(mockQuote({ premiumXlm: '1.0' }))
      .mockResolvedValueOnce(mockQuote({ premiumXlm: '2.5' }))

    const { rerender, result } = renderHook(
      ({ inputs }: { inputs: QuoteInputs }) => useQuote(inputs, QUOTE_DEBOUNCE_MS),
      { initialProps: { inputs: { ...baseInputs, coverage_tier: 'Basic' } } },
    )

    await act(async () => {
      jest.advanceTimersByTime(QUOTE_DEBOUNCE_MS)
    })
    await waitFor(() => expect(mockFetchQuote).toHaveBeenCalledTimes(1))

    await act(async () => {
      rerender({ inputs: { ...baseInputs, coverage_tier: 'Premium' } })
      jest.advanceTimersByTime(QUOTE_DEBOUNCE_MS)
    })

    await waitFor(() => expect(mockFetchQuote).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.quote?.premiumXlm).toBe('2.5')
    expect(mockFetchQuote).toHaveBeenLastCalledWith(
      expect.objectContaining({ coverage_tier: 'Premium' }),
      expect.any(AbortSignal),
    )
  })

  it('incomplete inputs stay idle and never simulate', async () => {
    renderHook(() => useQuote({ policy_type: 'Auto', region: 'Low' }, QUOTE_DEBOUNCE_MS))

    await act(async () => {
      jest.advanceTimersByTime(QUOTE_DEBOUNCE_MS * 2)
    })

    expect(mockFetchQuote).not.toHaveBeenCalled()
  })
})
