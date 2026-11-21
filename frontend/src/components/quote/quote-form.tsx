'use client'

import { useCallback, useState } from 'react'
import { QuoteForm } from '@/features/quote/QuoteForm'
import { QuoteResult } from '@/features/quote/QuoteResult'
import { useQuote } from '@/features/quote/useQuote'
import type { QuoteFormData } from '@/lib/schemas/quote'

export function QuoteExperience({ initialValues = {} }: { initialValues?: Partial<QuoteFormData> }) {
  const [inputs, setInputs] = useState<Partial<QuoteFormData>>(initialValues)
  const [isValid, setIsValid] = useState(false)

  const handleChange = useCallback((data: Partial<QuoteFormData>, valid: boolean) => {
    setInputs(data)
    setIsValid(valid)
  }, [])

  const { status, quote, error } = useQuote(isValid ? inputs : null)

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start">
      <section aria-label="Quote inputs">
        <QuoteForm onChange={handleChange} initialValues={initialValues} />
      </section>
      <section aria-label="Quote result" aria-live="polite">
        <QuoteResult status={status} quote={quote} error={error} inputs={inputs} />
      </section>
    </div>
  )
}
