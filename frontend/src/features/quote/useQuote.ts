'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchQuote } from './api'
import { useDebounce } from '@/hooks/use-debounce'
import { QuoteError, getQuoteErrorMessage } from '@/lib/api/quote'
import type { QuoteFormData, QuoteResponse } from '@/lib/schemas/quote'

export type QuoteStatus = 'idle' | 'loading' | 'success' | 'error'

export interface QuoteState {
  status: QuoteStatus
  quote: QuoteResponse | null
  error: string | null
}

/** Delay before a new quote simulation after coverage/input changes settle. */
export const QUOTE_DEBOUNCE_MS = 400

type ValidInputs = Required<Pick<QuoteFormData, 'policy_type' | 'region' | 'coverage_tier' | 'age' | 'risk_score'>>

/**
 * Live quote hook. Debounces coverage and related inputs so rapid keystrokes /
 * slider moves only trigger one simulation for the latest value.
 */
export function useQuote(inputs: Partial<ValidInputs> | null, debounceMs = QUOTE_DEBOUNCE_MS): QuoteState {
  const [state, setState] = useState<QuoteState>({ status: 'idle', quote: null, error: null })
  const seqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  // Stabilize on serialized content so object identity churn does not reset the timer.
  const complete = isComplete(inputs) ? inputs : null
  const debounceKey = complete ? serializeInputs(complete) : null

  // Hold `null` until inputs settle — including the first coverage value —
  // so there is no leading-edge simulation on mount / first keystroke.
  // When inputs become incomplete, clear immediately (delay 0).
  const settledKey = useDebounce(debounceKey, debounceKey === null ? 0 : debounceMs, null)
  const debounced = settledKey ? (JSON.parse(settledKey) as ValidInputs) : null

  useEffect(() => {
    if (!debounced) {
      abortRef.current?.abort()
      setState({ status: 'idle', quote: null, error: null })
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const seq = ++seqRef.current

    setState((s) => ({ ...s, status: 'loading', error: null }))

    fetchQuote(debounced, ctrl.signal).then(
      (quote) => {
        if (seq !== seqRef.current) return // stale
        setState({ status: 'success', quote, error: null })
      },
      (err: unknown) => {
        if ((err as Error).name === 'AbortError') return
        if (seq !== seqRef.current) return
        const msg = err instanceof QuoteError ? getQuoteErrorMessage(err) : 'Failed to fetch quote'
        setState({ status: 'error', quote: null, error: msg })
      },
    )

    return () => ctrl.abort()
  }, [settledKey]) // eslint-disable-line react-hooks/exhaustive-deps -- debounced parsed from key

  return state
}

function serializeInputs(inputs: ValidInputs): string {
  // Fixed key order so coverage_tier / numeric coverage inputs debounce reliably.
  return JSON.stringify({
    policy_type: inputs.policy_type,
    region: inputs.region,
    coverage_tier: inputs.coverage_tier,
    age: inputs.age,
    risk_score: inputs.risk_score,
  })
}

function isComplete(inputs: Partial<ValidInputs> | null): inputs is ValidInputs {
  if (!inputs) return false
  return !!(
    inputs.policy_type &&
    inputs.region &&
    inputs.coverage_tier &&
    typeof inputs.age === 'number' &&
    inputs.age >= 1 &&
    inputs.age <= 120 &&
    typeof inputs.risk_score === 'number' &&
    inputs.risk_score >= 1 &&
    inputs.risk_score <= 10
  )
}
