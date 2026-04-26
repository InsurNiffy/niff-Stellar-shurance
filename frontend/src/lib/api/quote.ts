import { getConfig } from '@/config/env'
import type { QuoteFormData, QuoteResponse } from '@/lib/schemas/quote'
import { QuoteResponseSchema } from '@/lib/schemas/quote'

export class QuoteError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'QuoteError'
  }
}

export async function generatePremium(
  data: QuoteFormData,
  signal?: AbortSignal,
): Promise<QuoteResponse> {
  const { apiUrl } = getConfig()

  // Strip empty source_account before sending
  const body: Record<string, unknown> = {
    policy_type: data.policy_type,
    region: data.region,
    coverage_tier: data.coverage_tier,
    age: data.age,
    risk_score: data.risk_score,
  }
  if (data.source_account) body.source_account = data.source_account

  const res = await fetch(`${apiUrl}/quote/generate-premium`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ code: 'FETCH_FAILED', message: 'Request failed' }))
    throw new QuoteError(
      (err as { code?: string }).code ?? 'FETCH_FAILED',
      (err as { message?: string }).message ?? 'Failed to generate quote',
    )
  }

  const json: unknown = await res.json()
  const parsed = QuoteResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new QuoteError('PARSE_ERROR', `Unexpected response: ${parsed.error.message}`)
  }
  return parsed.data
}

export const QUOTE_TTL_SECONDS = 300 // 5 minutes

export const QUOTE_ERROR_MESSAGES: Record<string, string> = {
  ACCOUNT_NOT_FOUND: 'Source account not found on the network',
  WRONG_NETWORK: 'Source account is on a different network',
  FETCH_FAILED: 'Network request failed. Please try again.',
  PARSE_ERROR: 'Unexpected server response. Please try again.',
  RATE_LIMIT_EXCEEDED: 'Too many requests. Please wait a moment.',
}

export function getQuoteErrorMessage(error: QuoteError): string {
  return QUOTE_ERROR_MESSAGES[error.code] ?? error.message
}

/**
 * @deprecated Use generatePremium() directly.
 * Kept for backward compatibility with policy-initiation.tsx.
 */
export class QuoteAPI {
  static async getQuoteById(_quoteId: string): Promise<never> {
    throw new QuoteError('NOT_SUPPORTED', 'getQuoteById is not supported. Use generatePremium().')
  }
}
