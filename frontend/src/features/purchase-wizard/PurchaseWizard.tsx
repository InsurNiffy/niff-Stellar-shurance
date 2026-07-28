'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Stepper, type Step } from '@/components/ui/stepper'
import { useDraftPersistence } from '@/hooks/use-draft-persistence'
import { CoverageDetailsStep } from './CoverageDetailsStep'
import { parseDeepLinkCoverage } from './deep-link'
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

/** Returns true when the wizard has unsaved data worth guarding. */
function hasUnsavedData(step: WizardStep, coverageData: Partial<QuoteFormData>): boolean {
  if (step > 0) return true
  return Object.values(coverageData).some((v) => v !== undefined && v !== '' && v !== null)
}

export function PurchaseWizard() {
  const { hasDraft, saveDraft, loadDraft, clearDraft } = useDraftPersistence<WizardDraft>(
    WIZARD_DRAFT_KEY,
    WIZARD_SCHEMA_VERSION,
  )
  const searchParams = useSearchParams()

  // Restore draft on mount
  const [step, setStep] = useState<WizardStep>(0)
  const [coverageData, setCoverageData] = useState<Partial<QuoteFormData>>({})
  const [quote, setQuote] = useState<QuoteResponse | null>(null)
  const [quoteExpiresAt, setQuoteExpiresAt] = useState<number | null>(null)
  const restoredRef = useRef(false)
  const completedRef = useRef(false)

  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true

    // A shared quote link takes priority over any saved draft. Only the
    // coverage inputs are trusted from the URL — the quote itself is always
    // regenerated through the normal flow, never bypassed.
    const deepLinkCoverage = parseDeepLinkCoverage(searchParams)
    if (deepLinkCoverage) {
      setCoverageData(deepLinkCoverage)
      return
    }

    if (hasDraft) {
      const draft = loadDraft()
      if (draft) {
        setStep(draft.step)
        setCoverageData(draft.coverageData)
        setQuote(draft.quote)
        setQuoteExpiresAt(draft.quoteExpiresAt)
      }
    }
  }, [hasDraft, loadDraft, searchParams])

  // Navigation guard — warn before discarding entered coverage details
  useEffect(() => {
    if (completedRef.current || !hasUnsavedData(step, coverageData)) return

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }

    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [step, coverageData])

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
    completedRef.current = true
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
