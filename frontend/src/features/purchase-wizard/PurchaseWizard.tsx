'use client'

import { useCallback, useEffect, useRef } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Stepper, type Step } from '@/components/ui/stepper'
import { useDraftPersistence } from '@/hooks/use-draft-persistence'
import { CoverageDetailsStep } from './CoverageDetailsStep'
import { QuoteReviewStep } from './QuoteReviewStep'
import { WalletSignStep } from './WalletSignStep'
import type { WizardDraft, WizardStep } from './types'
import { WIZARD_DRAFT_KEY, WIZARD_SCHEMA_VERSION } from './types'
import type { QuoteFormData, QuoteResponse } from '@/lib/schemas/quote'
import { useState } from 'react'

const STEP_LABELS = ['Coverage Details', 'Quote Review', 'Sign & Submit']

function buildSteps(current: WizardStep): Step[] {
  return STEP_LABELS.map((title, i) => ({
    id: String(i),
    title,
    status: i < current ? 'completed' : i === current ? 'active' : 'pending',
  })) as Step[]
}

export function PurchaseWizard() {
  const { hasDraft, saveDraft, loadDraft, clearDraft } = useDraftPersistence<WizardDraft>(
    WIZARD_DRAFT_KEY,
    WIZARD_SCHEMA_VERSION,
  )

  // Restore draft on mount
  const [step, setStep] = useState<WizardStep>(0)
  const [coverageData, setCoverageData] = useState<Partial<QuoteFormData>>({})
  const [quote, setQuote] = useState<QuoteResponse | null>(null)
  const [quoteExpiresAt, setQuoteExpiresAt] = useState<number | null>(null)
  const [coverageFormKey, setCoverageFormKey] = useState(0)
  const restoredRef = useRef(false)

  useEffect(() => {
    if (!hasDraft || restoredRef.current) return
    restoredRef.current = true
    const draft = loadDraft()
    if (draft) {
      setStep(draft.step)
      setCoverageData(draft.coverageData)
      setQuote(draft.quote)
      setQuoteExpiresAt(draft.quoteExpiresAt)
      setCoverageFormKey((k) => k + 1)
    }
  }, [hasDraft, loadDraft])

  const persistDraft = useCallback(
    (patch: Partial<WizardDraft>) => {
      saveDraft({
        step,
        coverageData,
        quote,
        quoteExpiresAt,
        ...patch,
      })
    },
    [saveDraft, step, coverageData, quote, quoteExpiresAt],
  )

  // Step 1 → 2
  const handleCoverageNext = useCallback(
    (data: QuoteFormData) => {
      setCoverageData(data)
      setStep(1)
      persistDraft({ step: 1, coverageData: data })
    },
    [persistDraft],
  )

  const handleCoverageChange = useCallback(
    (data: Partial<QuoteFormData>) => {
      setCoverageData(data)
      persistDraft({ coverageData: data })
    },
    [persistDraft],
  )

  // Step 2 → 3
  const handleQuoteNext = useCallback(
    (q: QuoteResponse, exp: number) => {
      setQuote(q)
      setQuoteExpiresAt(exp)
      setStep(2)
      persistDraft({ step: 2, quote: q, quoteExpiresAt: exp })
    },
    [persistDraft],
  )

  // Back from step 2 → 1
  const handleQuoteBack = useCallback(() => {
    setStep(0)
    persistDraft({ step: 0 })
  }, [persistDraft])

  // Back from step 3 → 2
  const handleSignBack = useCallback(() => {
    setStep(1)
    persistDraft({ step: 1 })
  }, [persistDraft])

  // Success
  const handleSuccess = useCallback(() => {
    clearDraft()
  }, [clearDraft])

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6 text-center">Purchase Insurance Policy</h1>

      <Stepper
        steps={buildSteps(step)}
        currentStep={step}
        className="mb-8"
      />

      <Card>
        <CardHeader>
          <CardTitle>{STEP_LABELS[step]}</CardTitle>
        </CardHeader>
        <CardContent>
          {step === 0 && (
            <CoverageDetailsStep
              key={coverageFormKey}
              defaultValues={coverageData}
              onNext={handleCoverageNext}
              onChange={handleCoverageChange}
            />
          )}

          {step === 1 && (
            <QuoteReviewStep
              coverageData={coverageData as QuoteFormData}
              cachedQuote={quote}
              cachedQuoteExpiresAt={quoteExpiresAt}
              onNext={handleQuoteNext}
              onBack={handleQuoteBack}
            />
          )}

          {step === 2 && quote && (
            <WalletSignStep
              coverageData={coverageData as QuoteFormData}
              quote={quote}
              quoteExpiresAt={quoteExpiresAt!}
              onBack={handleSignBack}
              onSuccess={handleSuccess}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
