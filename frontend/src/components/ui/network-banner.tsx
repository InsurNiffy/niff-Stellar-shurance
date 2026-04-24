'use client'

import { WifiOff } from 'lucide-react'
import { useNetworkStatus } from '@/hooks/use-network-status'

/**
 * NetworkBanner — non-blocking, persistent banner shown while the browser is
 * offline. Sits at the top of the viewport (z-[200]) so it never obscures
 * interactive content. Disappears automatically on reconnection.
 */
export function NetworkBanner() {
  const { isOnline } = useNetworkStatus()

  if (isOnline) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="network-banner"
      className="fixed inset-x-0 top-0 z-[200] flex items-center gap-2 bg-yellow-500 px-4 py-2 text-sm font-medium text-yellow-950"
      style={{ paddingTop: `calc(0.5rem + env(safe-area-inset-top, 0px))` }}
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>You&apos;re offline. Some features may be unavailable.</span>
    </div>
  )
}
