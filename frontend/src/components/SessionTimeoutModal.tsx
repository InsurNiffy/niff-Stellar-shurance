'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ToastAction } from '@/components/ui/toast'
import { toast } from '@/components/ui/use-toast'
import { useWallet } from '@/features/wallet'
import { setJwt } from '@/lib/hooks/useAuth'
import { useIdleTimeout } from '@/hooks/use-idle-timeout'

/** Idle timeout in ms — 30 minutes. Configurable via env for testing. */
const TIMEOUT_MS =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SESSION_TIMEOUT_MS
    ? parseInt(process.env.NEXT_PUBLIC_SESSION_TIMEOUT_MS, 10)
    : 30 * 60 * 1000

const WARNING_LEAD_MS = 2 * 60 * 1000

/**
 * Warns before the idle wallet session expires. Uses a toast (not a blocking modal)
 * with a "Stay connected" action that resets the idle timer.
 */
export function SessionTimeoutModal() {
  const { disconnect, connectionStatus } = useWallet()
  const router = useRouter()
  const activeToastDismiss = useRef<(() => void) | null>(null)

  const handleLogout = useCallback(async () => {
    activeToastDismiss.current?.()
    activeToastDismiss.current = null
    setJwt(null)
    await disconnect()
    router.push('/')
  }, [disconnect, router])

  const { showWarning, stayLoggedIn } = useIdleTimeout({
    timeoutMs: TIMEOUT_MS,
    warningMs: WARNING_LEAD_MS,
    onLogout: handleLogout,
  })

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      activeToastDismiss.current?.()
      activeToastDismiss.current = null
      return
    }

    if (!showWarning) {
      return
    }

    if (activeToastDismiss.current) {
      return
    }

    const handle = toast({
      variant: 'warning',
      title: 'Wallet session expiring soon',
      description:
        'Your wallet session will end soon due to inactivity. Choose stay connected to remain signed in.',
      duration: 0,
      action: (
        <ToastAction
          altText="Stay connected"
          data-testid="stay-connected-action"
          onClick={() => {
            stayLoggedIn()
            handle.dismiss()
            activeToastDismiss.current = null
          }}
        >
          Stay connected
        </ToastAction>
      ),
    })
    activeToastDismiss.current = handle.dismiss

    return () => {
      handle.dismiss()
      activeToastDismiss.current = null
    }
  }, [showWarning, connectionStatus, stayLoggedIn])

  return null
}
