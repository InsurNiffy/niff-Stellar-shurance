/**
 * Analytics helpers — Plausible (cookieless, privacy-first).
 *
 * Events fire only when window.plausible is present, which happens only when
 * the AnalyticsScript component injected the Plausible script tag
 * (i.e. NEXT_PUBLIC_ANALYTICS_ENABLED=true and NEXT_PUBLIC_ANALYTICS_DOMAIN
 * is set). In local dev both vars are absent, so nothing is ever sent.
 *
 * Custom event catalog (internal reference):
 *
 * | Event name              | Props                                 | Fired when                         |
 * |-------------------------|---------------------------------------|------------------------------------|
 * | landing_view            | —                                     | Landing page mounts                |
 * | quote_started           | risk_category, contract_type          | Quote form first interaction       |
 * | quote_received          | risk_category, contract_type          | Quote API returns successfully     |
 * | bind_started            | —                                     | User clicks "Purchase Policy"      |
 * | bind_wallet_connected   | —                                     | Wallet connected in policy flow    |
 * | bind_completed          | —                                     | Policy confirmed on-chain          |
 * | vote_cast               | vote_direction (approve | reject)     | User submits a vote on a claim     |
 * | route_segment_error     | segment, error_name, digest?          | Next.js route error.tsx recovered  |
 *
 * PII policy:
 *   - Wallet addresses are NEVER included in any event prop.
 *   - Contract addresses are NEVER included.
 *   - Only coarse categorical values (risk_category, contract_type, vote_direction).
 *   - Plausible itself stores no cookies and no IP addresses.
 */

type PlausibleFn = (
  event: string,
  options?: { props?: Record<string, string | number | boolean> },
) => void

declare global {
  interface Window {
    plausible?: PlausibleFn
  }
}

/**
 * Fire a Plausible custom event.
 * No-ops silently when Plausible is not loaded (analytics disabled or dev).
 */
function track(
  event: string,
  props?: Record<string, string | number | boolean>,
): void {
  if (typeof window === 'undefined') return
  try {
    window.plausible?.(event, props ? { props } : undefined)
  } catch {
    // Never let analytics errors surface to users
  }
}

// ---------------------------------------------------------------------------
// Funnel step helpers
// ---------------------------------------------------------------------------

/** Call once when the landing page mounts. */
export function trackLandingView(): void {
  track('landing_view')
}

/** Call when the user first interacts with the quote form. */
export function trackQuoteStarted(opts: {
  riskCategory: string
  contractType: string
}): void {
  track('quote_started', {
    risk_category: opts.riskCategory,
    contract_type: opts.contractType,
  })
}

/** Call when a quote is successfully returned from the API. */
export function trackQuoteReceived(opts: {
  riskCategory: string
  contractType: string
}): void {
  track('quote_received', {
    risk_category: opts.riskCategory,
    contract_type: opts.contractType,
  })
}

/** Call when the user navigates from quote to policy (bind flow entry). */
export function trackBindStarted(): void {
  track('bind_started')
}

/** Call when the wallet is connected in the policy flow. */
export function trackBindWalletConnected(): void {
  track('bind_wallet_connected')
}

/** Call when the policy is confirmed on-chain. */
export function trackBindCompleted(): void {
  track('bind_completed')
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
