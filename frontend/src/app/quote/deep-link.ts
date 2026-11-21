import { z } from 'zod'

import type { QuoteFormData } from '@/lib/schemas/quote'

/** Session hand-off key used by the "Purchase Policy" CTA. */
export const PENDING_QUOTE_KEY = 'niffy.pendingQuote'

const DeepLinkSchema = z.object({
  type: z.string().optional(),
  region: z.string().optional(),
  coverage: z.string().optional(),
})

const TYPE_ALIASES: Record<string, QuoteFormData['policy_type']> = {
  auto: 'Auto', car: 'Auto', health: 'Health', property: 'Property', home: 'Property',
}
const REGION_ALIASES: Record<string, QuoteFormData['region']> = {
  low: 'Low', medium: 'Medium', mid: 'Medium', high: 'High',
}
const COVERAGE_ALIASES: Record<string, QuoteFormData['coverage_tier']> = {
  basic: 'Basic', standard: 'Standard', premium: 'Premium',
}

function lookup<T extends string>(raw: string | undefined, aliases: Record<string, T>): T | undefined {
  if (!raw) return undefined
  return aliases[raw.trim().toLowerCase()]
}

/**
 * Parse marketing/campaign deep-link params (type, region, coverage).
 * Unknown or malformed values are ignored rather than surfaced as errors.
 */
export function parseQuoteDeepLink(params: URLSearchParams): Partial<QuoteFormData> {
  const parsed = DeepLinkSchema.safeParse({
    type: params.get('type') ?? undefined,
    region: params.get('region') ?? undefined,
    coverage: params.get('coverage') ?? undefined,
  })
  if (!parsed.success) return {}

  const prefilled: Partial<QuoteFormData> = {}
  const type = lookup(parsed.data.type, TYPE_ALIASES)
  const region = lookup(parsed.data.region, REGION_ALIASES)
  const coverage = lookup(parsed.data.coverage, COVERAGE_ALIASES)
  if (type) prefilled.policy_type = type
  if (region) prefilled.region = region
  if (coverage) prefilled.coverage_tier = coverage
  return prefilled
}
