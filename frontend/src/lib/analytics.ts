/**
 * Analytics helpers — Plausible (cookieless, privacy-first).
 *
 * Events fire only when the user has accepted analytics consent AND
 * window.plausible is present (AnalyticsScript injected the tag).
 *
 * PII policy:
 *   - Wallet addresses are NEVER included in any event prop.
 *   - Contract addresses, emails, and other identifiers are stripped before send.
 *   - Only coarse categorical values (policy_type, vote_direction, etc.).
 */

import { getConsent } from '@/lib/cookie-consent'

type PlausibleFn = (
  event: string,
  options?: { props?: Record<string, string | number | boolean> },
) => void

declare global {
  interface Window {
    plausible?: PlausibleFn
  }
}

const STELLAR_ADDRESS_RE = /^G[A-Z0-9]{55}$/
const PII_PROP_KEYS = new Set([
  'wallet',
  'wallet_address',
  'walletAddress',
  'address',
  'source_account',
  'sourceAccount',
  'email',
  'holder',
  'voter',
  'public_key',
  'publicKey',
])

export function sanitizeAnalyticsProps(
  props?: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> | undefined {
  if (!props) return undefined

  const sanitized: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(props)) {
    if (PII_PROP_KEYS.has(key)) continue
    if (typeof value === 'string' && STELLAR_ADDRESS_RE.test(value)) continue
    if (
      typeof value === 'string' &&
      value.includes('@') &&
      value.includes('.')
    ) {
      continue
    }
    sanitized[key] = value
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

function hasAnalyticsConsent(): boolean {
  if (typeof window === 'undefined') return false
  return getConsent() === 'accepted'
}

/**
 * Fire a Plausible custom event.
 * No-ops when consent is missing or Plausible is not loaded.
 */
function track(
  event: string,
  props?: Record<string, string | number | boolean>,
): void {
  if (typeof window === 'undefined') return
  if (!hasAnalyticsConsent()) return
  try {
    const safeProps = sanitizeAnalyticsProps(props)
    window.plausible?.(event, safeProps ? { props: safeProps } : undefined)
  } catch {
    // Never let analytics errors surface to users
  }
}

/** Call on route changes (SPA page views). */
export function trackPageView(path?: string): void {
  track('page_view', path ? { path: path.slice(0, 128) } : undefined)
}

/** Call when a quote is successfully submitted. */
export function trackQuoteSubmitted(opts: {
  policyType: string
  region: string
  coverageTier: string
}): void {
  track('quote_submitted', {
    policy_type: opts.policyType,
    region: opts.region,
    coverage_tier: opts.coverageTier,
  })
}

/** Call when a policy is confirmed on-chain. */
export function trackPolicyInitiated(): void {
  track('policy_initiated')
}

/** Call when a claim is successfully filed on-chain. */
export function trackClaimFiled(): void {
  track('claim_filed')
}

/** Call when the user submits a vote on a claim. */
export function trackVoteCast(direction: 'approve' | 'reject'): void {
  track('vote_cast', { vote_direction: direction })
}

/**
 * Anonymized route-segment failure (Next.js `error.tsx`). No stack traces,
 * no error.message (may contain environment-specific paths). Safe for Plausible props.
 */
export function trackRouteSegmentError(opts: {
  segment: string
  errorName: string
  digest?: string
}): void {
  const props: Record<string, string | number | boolean> = {
    segment: opts.segment.slice(0, 64),
    error_name: opts.errorName.slice(0, 128),
  }
  if (opts.digest) props.digest = opts.digest.slice(0, 128)
  track('route_segment_error', props)
}

// ── Appeal funnel analytics ─────────────────────────────────────────────────
//
// Mirrors the trackVoteCast pattern. Each call corresponds to one stage of the
// appeal funnel:
//   appeal_button_clicked → appeal_confirm_opened → appeal_simulated →
//   appeal_signing → appeal_submitted → appeal_success | appeal_failure
//
// Error codes are coarse categorical values only (never PII).

/** User taps "Appeal Decision" button — funnel entry point. */
export function trackAppealButtonClicked(): void {
  track('appeal_button_clicked')
}

/** User sees the confirmation modal (after clicking Appeal). */
export function trackAppealConfirmOpened(): void {
  track('appeal_confirm_opened')
}

/** Server-side simulation completed (pre-wallet step). */
export function trackAppealSimulated(outcome: 'pass' | 'fail', errorCode?: string): void {
  const props: Record<string, string | number | boolean> = { outcome }
  if (errorCode) props.error_code = errorCode.slice(0, 64)
  track('appeal_simulated', props)
}

/** Wallet signing prompt was opened. */
export function trackAppealSigning(): void {
  track('appeal_signing')
}

/** Signed XDR sent to the backend (final network call). */
export function trackAppealSubmitted(): void {
  track('appeal_submitted')
}

/** Backend confirmed the transaction on-chain. */
export function trackAppealSuccess(): void {
  track('appeal_success')
}

/** Any stage from simulation through submission resulted in an error. */
export function trackAppealFailure(opts: {
  stage: 'simulate' | 'sign' | 'submit'
  errorCode?: string
}): void {
  const props: Record<string, string | number | boolean> = {
    stage: opts.stage,
  }
  if (opts.errorCode) props.error_code = opts.errorCode.slice(0, 64)
  track('appeal_failure', props)
}
