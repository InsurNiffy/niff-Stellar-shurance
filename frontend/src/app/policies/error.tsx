'use client'

import { RouteError } from '@/components/route-error'

export default function PoliciesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteError error={error} reset={reset} area="Policies" segment="policies" />
}
