import { QuoteFormSchema, type QuoteFormData } from '@/lib/schemas/quote'

/**
 * Parses coverage details prefilled via a shared quote link's query params
 * (see features/quote/QuoteResult.tsx buildPurchaseHref). Returns null when
 * the params are missing or fail validation, so callers can fall back to the
 * normal blank/draft start flow.
 */
export function parseDeepLinkCoverage(params: URLSearchParams): QuoteFormData | null {
  const policyType = params.get('policy_type')
  const region = params.get('region')
  const coverageTier = params.get('coverage_tier')
  const ageRaw = params.get('age')
  const riskScoreRaw = params.get('risk_score')
  const sourceAccount = params.get('source_account')

  if (!policyType || !region || !coverageTier || !ageRaw || !riskScoreRaw) {
    return null
  }

  const candidate = {
    policy_type: policyType,
    region,
    coverage_tier: coverageTier,
    age: Number(ageRaw),
    risk_score: Number(riskScoreRaw),
    source_account: sourceAccount ?? undefined,
  }

  const result = QuoteFormSchema.safeParse(candidate)
  return result.success ? result.data : null
}
