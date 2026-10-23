'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseIdleTimeoutOptions {
  /** Total idle time before auto-logout (ms). Default: 15 minutes. */
  timeoutMs?: number
  /** How long before timeout to show the warning modal (ms). Default: 60 seconds. */
  warningMs?: number
  onLogout: () => void
}

const IDLE_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const

export function useIdleTimeout({
  timeoutMs = 15 * 60 * 1000,
  warningMs = 60 * 1000,
  onLogout,
}: UseIdleTimeoutOptions) {
  const [showWarning, setShowWarning] = useState(false)
  const [secondsRemaining, setSecondsRemaining] = useState(0)
  const logoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warningTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearTimers = useCallback(() => {
    if (logoutTimer.current) clearTimeout(logoutTimer.current)
    if (warningTimer.current) clearTimeout(warningTimer.current)
    if (countdownTimer.current) clearInterval(countdownTimer.current)
  }, [])

  const resetTimers = useCallback(() => {
    clearTimers()
    setShowWarning(false)
    setSecondsRemaining(0)

    warningTimer.current = setTimeout(() => {
      setShowWarning(true)
      const totalSeconds = Math.round(warningMs / 1000)
      setSecondsRemaining(totalSeconds)
      countdownTimer.current = setInterval(() => {
        setSecondsRemaining((s) => {
          if (s <= 1) {
            if (countdownTimer.current) clearInterval(countdownTimer.current)
            return 0
          }
          return s - 1
        })
      }, 1000)
    }, timeoutMs - warningMs)

    logoutTimer.current = setTimeout(() => {
      setShowWarning(false)
      setSecondsRemaining(0)
      onLogout()
    }, timeoutMs)
  }, [clearTimers, onLogout, timeoutMs, warningMs])

  // Start timers and attach activity listeners
  useEffect(() => {
    resetTimers()

    const handleActivity = () => resetTimers()
    IDLE_EVENTS.forEach((e) => window.addEventListener(e, handleActivity, { passive: true }))

    return () => {
      clearTimers()
      IDLE_EVENTS.forEach((e) => window.removeEventListener(e, handleActivity))
    }
  }, [resetTimers, clearTimers])

  const stayLoggedIn = useCallback(() => {
    resetTimers()
  }, [resetTimers])

  return { showWarning, secondsRemaining, stayLoggedIn }
}
