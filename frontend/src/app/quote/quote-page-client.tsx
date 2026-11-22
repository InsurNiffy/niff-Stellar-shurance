'use client'

import { useSearchParams } from 'next/navigation'

import { QuoteExperience } from '@/components/quote/quote-form'
import { parseQuoteDeepLink } from './deep-link'

export function QuotePageClient() {
  const searchParams = useSearchParams()
  const initialValues = parseQuoteDeepLink(searchParams)
  return <QuoteExperience initialValues={initialValues} />
}
