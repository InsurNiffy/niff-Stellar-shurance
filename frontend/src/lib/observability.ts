/**
 * Client-side observability helpers — anonymized, no PII.
 *
 * Route errors: use {@link logRouteSegmentError} from Next.js `error.tsx` files.
 * Wallet signing and other interactive failures stay inline (try/catch); they are
 * not reported here and are not caught by route error boundaries.
 */

import { trackRouteSegmentError } from '@/lib/analytics'

export function logRouteSegmentError(input: {
  /** Logical segment, e.g. `claims`, `policies`, `admin` */
  segment: string
  error: Error & { digest?: string }
}): void {
  if (typeof window === 'undefined') return
  try {
    if (process.env.NODE_ENV === 'production') {
      trackRouteSegmentError({
        segment: input.segment,
        errorName: input.error.name || 'Error',
        digest: input.error.digest,
      })
    } else {
      console.error('[route-segment-error dev]', {
        segment: input.segment,
        name: input.error.name,
        digest: input.error.digest,
      })
    }
  } catch {
    // Observability must not throw
  }
}
