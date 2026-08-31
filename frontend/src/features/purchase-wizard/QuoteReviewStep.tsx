'use client'

import { AlertCircle, Clock, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { generatePremium, QuoteError, getQuoteErrorMessage, QUOTE_TTL_SECONDS } from '@/lib/api/quote'
import { formatTokenAmount } from '@/lib/formatTokenAmount'
import type { QuoteFormData, QuoteResponse } from '@/lib/schemas/quote'

interface Props {
  coverageData: QuoteFormData
  cachedQuote: QuoteResponse | null
  cachedQuoteExpiresAt: number | null
  onNext: (quote: QuoteResponse, expiresAt: number) => void
  onBack: () => void
}

function TtlCountdown({ expiresAt, onExpired }: { expiresAt: number; onExpired: () => void }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAt - Date.now()))
  const firedRef = useRef(false)

  useEffect(() => {
    firedRef.current = false
    const id = setInterval(() => {
      const r = Math.max(0, expiresAt - Date.now())
      setRemaining(r)
      if (r === 0 && !firedRef.current) {
        firedRef.current = true
        onExpired()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [expiresAt, onExpired])

  const secs = Math.floor(remaining / 1000)
  const mins = Math.floor(secs / 60)
  const s = secs % 60
  const urgent = secs < 60

  return (
    <div
      className={`flex items-center gap-1.5 text-sm ${urgent ? 'text-orange-600' : 'text-muted-foreground'}`}
      role="status"
      aria-live="polite"
    >
      <Clock className="h-4 w-4" aria-hidden="true" />
      {remaining === 0
        ? 'Quote expired'
        : `Quote valid for ${mins}:${String(s).padStart(2, '0')}`}
    </div>
  )
}

export function QuoteReviewStep({ coverageData, cachedQuote, cachedQuoteExpiresAt, onNext, onBack }: Props) {
  const [quote, setQuote] = useState<QuoteResponse | null>(cachedQuote)
  const [expiresAt, setExpiresAt] = useState<number | null>(cachedQuoteExpiresAt)
  const [expired, setExpired] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Auto-fetch if no valid cached quote
  useEffect(() => {
    const hasValid = quote && expiresAt && expiresAt > Date.now()
    if (!hasValid) {
      fetchQuote()
    }
    return () => abortRef.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchQuote() {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setLoading(true)
    setError(null)
    setExpired(false)
    try {
      const result = await generatePremium(coverageData, abortRef.current.signal)
      const exp = Date.now() + QUOTE_TTL_SECONDS * 1000
      setQuote(result)
      setExpiresAt(exp)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      const msg = err instanceof QuoteError ? getQuoteErrorMessage(err) : 'Failed to generate quote'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-4 py-12" role="status" aria-label="Loading quote">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-muted-foreground">Calculating your premium…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4 py-4" role="alert">
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" aria-hidden="true" />
          <p className="font-medium">Quote failed</p>
        </div>
        <p className="text-sm text-muted-foreground">{error}</p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack}>Back</Button>
          <Button onClick={fetchQuote}>Retry</Button>
        </div>
      </div>
    )
  }

  if (!quote) return null

  if (expired) {
    return (
      <div className="space-y-4 py-4 text-center" role="alert">
        <AlertCircle className="h-10 w-10 text-orange-500 mx-auto" aria-hidden="true" />
        <p className="font-semibold">Quote expired</p>
        <p className="text-sm text-muted-foreground">Premiums may have changed. Please regenerate.</p>
        <div className="flex justify-center gap-3">
          <Button variant="outline" onClick={onBack}>Back</Button>
          <Button onClick={fetchQuote}>Regenerate Quote</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {expiresAt && <TtlCountdown expiresAt={expiresAt} onExpired={() => setExpired(true)} />}

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-1">Annual Premium</p>
            <p className="text-4xl font-bold text-primary" aria-label={`${formatTokenAmount(quote.premiumXlm, 0)} XLM`}>
              {formatTokenAmount(quote.premiumXlm, 0)} XLM
            </p>
            <p className="text-xs text-muted-foreground mt-1">({quote.premiumStroops} stroops)</p>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Policy Type</dt>
              <dd className="font-medium">{coverageData.policy_type}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Region</dt>
              <dd className="font-medium">{coverageData.region}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Coverage Tier</dt>
              <dd className="font-medium">{coverageData.coverage_tier}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Age</dt>
              <dd className="font-medium">{coverageData.age}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Risk Score</dt>
              <dd className="font-medium">{coverageData.risk_score}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Min Resource Fee</dt>
              <dd className="font-medium">{quote.minResourceFee} stroops</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Protocol Fee</dt>
              <dd className="font-medium">{((quote.protocolFeeBps ?? 500) / 100).toFixed(2)}%</dd>
            </div>
          </dl>

          <Badge variant={quote.source === 'simulation' ? 'success' : 'secondary'}>
            {quote.source === 'simulation' ? 'Live simulation' : 'Local estimate'}
          </Badge>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button onClick={() => onNext(quote, expiresAt!)}>Proceed to Sign</Button>
      </div>
    </div>
  )
}
