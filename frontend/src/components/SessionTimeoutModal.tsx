'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/features/wallet'
import { setJwt } from '@/lib/hooks/useAuth'
import { useIdleTimeout } from '@/hooks/use-idle-timeout'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/**
 * Idle timeout in ms — default 15 minutes. Override via env for testing.
 * Issue #1667.
 */
const IDLE_TIMEOUT_MS =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SESSION_TIMEOUT_MS
    ? parseInt(process.env.NEXT_PUBLIC_SESSION_TIMEOUT_MS, 10)
    : 15 * 60 * 1000

/** Show the modal 60 seconds before the session expires. */
const WARNING_LEAD_MS = 60 * 1000

/**
 * Blocking modal that appears when the user has been idle for
 * (IDLE_TIMEOUT_MS - WARNING_LEAD_MS). Shows a live countdown and logs the
 * user out when the countdown reaches zero.
 *
 * Accessibility:
 *   - role="alertdialog" is applied via DialogContent's underlying Radix primitive
 *   - Focus is trapped inside the modal (Radix handles this)
 *   - Countdown is announced via aria-live="polite"
 */
export function SessionTimeoutModal() {
  const { disconnect, connectionStatus } = useWallet()
  const router = useRouter()
  const hasLoggedOut = useRef(false)

  const handleLogout = useCallback(async () => {
    if (hasLoggedOut.current) return
    hasLoggedOut.current = true
    setJwt(null)
    await disconnect()
    router.push('/')
  }, [disconnect, router])

  const { showWarning, secondsRemaining, stayLoggedIn } = useIdleTimeout({
    timeoutMs: IDLE_TIMEOUT_MS,
    warningMs: WARNING_LEAD_MS,
    onLogout: handleLogout,
  })

  // Reset the logout guard when a new warning opens so successive timeouts work
  useEffect(() => {
    if (!showWarning) {
      hasLoggedOut.current = false
    }
  }, [showWarning])

  // Only show modal when the wallet is connected
  const isOpen = showWarning && connectionStatus === 'connected'

  function handleExtendSession() {
    stayLoggedIn()
  }

  function handleSignOut() {
    void handleLogout()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) stayLoggedIn() }}>
      <DialogContent
        // Override the Radix role to alertdialog for urgent session expiry messaging
        role="alertdialog"
        aria-modal="true"
        hideCloseButton
        // Prevent accidental dismissal by clicking the overlay
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="max-w-sm"
      >
        <DialogHeader>
          <DialogTitle>Session expiring soon</DialogTitle>
          <DialogDescription>
            Your session will end due to inactivity. Extend your session to stay signed in.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 text-center">
          <p
            className="text-4xl font-bold tabular-nums tracking-tight text-primary"
            aria-live="polite"
            aria-atomic="true"
            aria-label={`${secondsRemaining} seconds remaining`}
          >
            {secondsRemaining}s
          </p>
          <p className="mt-1 text-sm text-muted-foreground">seconds remaining</p>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="default"
            className="w-full sm:w-auto"
            onClick={handleExtendSession}
            autoFocus
          >
            Extend session
          </Button>
          <Button
            variant="ghost"
            className="w-full sm:w-auto"
            onClick={handleSignOut}
          >
            Sign out now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
