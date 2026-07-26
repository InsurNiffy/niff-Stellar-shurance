'use client'

import { AlertCircle } from 'lucide-react'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTokenAmount } from '@/lib/formatTokenAmount'
import type { QuoteFormData, QuoteResponse } from '@/lib/schemas/quote'
import type { QuoteStatus } from './useQuote'

interface Props {
  status: QuoteStatus
  quote: QuoteResponse | null
  error: string | null
  inputs: Partial<QuoteFormData>
}

function buildPurchaseHref(inputs: Partial<QuoteFormData>, quote: QuoteResponse): string {
  const p = new URLSearchParams()
  if (inputs.policy_type) p.set('policy_type', inputs.policy_type)
  if (inputs.region) p.set('region', inputs.region)
  if (inputs.coverage_tier) p.set('coverage_tier', inputs.coverage_tier)
  if (inputs.age != null) p.set('age', String(inputs.age))
  if (inputs.risk_score != null) p.set('risk_score', String(inputs.risk_score))
  if (inputs.source_account) p.set('source_account', inputs.source_account)
  p.set('premium_xlm', quote.premiumXlm)
  p.set('premium_stroops', quote.premiumStroops)
  return `/purchase?${p}`
}

export function QuoteResult({ status, quote, error, inputs }: Props) {
  if (status === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground" aria-live="polite">
        <p className="text-sm">Fill in all fields to see your estimated premium.</p>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div role="status" aria-label="Loading quote" className="space-y-4 py-4">
        <Skeleton className="h-12 w-3/4 mx-auto" />
        <Skeleton className="h-4 w-1/2 mx-auto" />
        <div className="grid grid-cols-2 gap-3 mt-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
        </div>
        <span className="sr-only">Calculating your premium…</span>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-destructive">
        <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" aria-hidden="true" />
        <div>
          <p className="font-medium text-sm">Quote unavailable</p>
          <p className="text-sm mt-0.5">{error}</p>
        </div>
      </div>
    )
  }

  if (!quote) return null

  const href = buildPurchaseHref(inputs, quote)
  const symbol = quote.tokenSymbol ?? 'XLM'
  const decimals = quote.tokenDecimals ?? 7
  const protocolFeeBps = quote.protocolFeeBps ?? 500

  return (
    <div className="space-y-5" aria-live="polite" aria-atomic="true">
      <div className="text-center">
        <p className="text-sm text-muted-foreground mb-1">Estimated Annual Premium</p>
        <p
          className="text-5xl font-bold text-primary tabular-nums"
          aria-label={`${formatTokenAmount(quote.premiumStroops, decimals)} ${symbol}`}
        >
          {formatTokenAmount(quote.premiumStroops, decimals)} <span className="text-2xl">{symbol}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-1">{quote.premiumStroops} stroops</p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Policy Type</dt>
              <dd className="font-medium">{inputs.policy_type}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Region</dt>
              <dd className="font-medium">{inputs.region}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Coverage Tier</dt>
              <dd className="font-medium">{inputs.coverage_tier}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Age</dt>
              <dd className="font-medium">{inputs.age}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Risk Score</dt>
              <dd className="font-medium">{inputs.risk_score}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Min Resource Fee</dt>
              <dd className="font-medium">{quote.minResourceFee} stroops</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Protocol Fee</dt>
              <dd className="font-medium">{(protocolFeeBps / 100).toFixed(2)}%</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Badge variant={quote.source === 'simulation' ? 'success' : 'secondary'}>
        {quote.source === 'simulation' ? 'Live simulation' : 'Local estimate'}
      </Badge>

      <Button asChild className="w-full" size="lg">
        <Link href={href}>Get This Policy →</Link>
      </Button>
    </div>
  )
}
