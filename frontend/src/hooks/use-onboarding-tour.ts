'use client'

import { useCallback, useEffect, useRef } from 'react'

const TOUR_COMPLETED_KEY = 'niffyinsur-tour-completed'
const TOUR_PROGRESS_KEY = 'niffyinsur-tour-progress'

/** Per-wallet key so the tour is shown once for each newly connected wallet. */
function walletTourKey(address: string): string {
  return `${TOUR_COMPLETED_KEY}:${address}`
}

export interface TourStep {
  element: string
  popover: { title: string; description: string; side?: 'top' | 'bottom' | 'left' | 'right' }
}

const TOUR_STEPS: TourStep[] = [
  {
    element: '[data-tour="policy-dashboard"]',
    popover: {
      title: 'Policy dashboard',
      description: 'Review your active policies, claims, pending votes and wallet balance in one place.',
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="get-quote"]',
    popover: {
      title: 'Get a quote',
      description: 'Estimate your premium instantly by adjusting your coverage details.',
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="claims-board"]',
    popover: {
      title: 'Claims board',
      description: 'Browse open claims and see how the community votes on them on-chain.',
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="governance"]',
    popover: {
      title: 'Governance',
      description: 'Track parameter-change proposals and join the discussion before voting.',
      side: 'bottom',
    },
  },
]

export function isTourCompleted(address?: string | null): boolean {
  if (typeof window === 'undefined') return true
  if (address) return localStorage.getItem(walletTourKey(address)) === 'true'
  return localStorage.getItem(TOUR_COMPLETED_KEY) === 'true'
}

export function markTourCompleted(address?: string | null): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(TOUR_COMPLETED_KEY, 'true')
  if (address) localStorage.setItem(walletTourKey(address), 'true')
}

export function resetTour(address?: string | null): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(TOUR_COMPLETED_KEY)
  localStorage.removeItem(TOUR_PROGRESS_KEY)
  if (address) {
    localStorage.removeItem(walletTourKey(address))
    return
  }
  Object.keys(localStorage)
    .filter((key) => key.startsWith(`${TOUR_COMPLETED_KEY}:`))
    .forEach((key) => localStorage.removeItem(key))
}

interface UseOnboardingTourOptions {
  autoStart?: boolean
  address?: string | null
}

export function useOnboardingTour({ autoStart = true, address = null }: UseOnboardingTourOptions = {}) {
  const driverRef = useRef<{ drive: () => void; destroy: () => void } | null>(null)

  const startTour = useCallback(async () => {
    // Dynamically import driver.js to avoid SSR issues
    const { driver } = await import('driver.js')
    await import('driver.js/dist/driver.css')

    const availableSteps = TOUR_STEPS.filter((step) => document.querySelector(step.element))
    if (availableSteps.length === 0) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const d = driver({
      animate: !reduceMotion,
      showProgress: true,
      progressText: '{{current}} of {{total}}',
      steps: availableSteps,
      keyboardControl: true,
      allowClose: true,
      onNext: () => {
        localStorage.setItem(TOUR_PROGRESS_KEY, String(Number(localStorage.getItem(TOUR_PROGRESS_KEY) ?? '0') + 1))
      },
      onPrev: () => {
        localStorage.setItem(TOUR_PROGRESS_KEY, String(Math.max(0, Number(localStorage.getItem(TOUR_PROGRESS_KEY) ?? '0') - 1)))
      },
      onDestroyed: () => {
        // Skipping and completing both persist dismissal.
        markTourCompleted(address)
        localStorage.removeItem(TOUR_PROGRESS_KEY)
      },
      onDestroyStarted: () => {
        d.destroy()
      },
    })

    driverRef.current = d
    d.drive()
  }, [address])

  // Start only on the first connection of a wallet, never on an anonymous visit.
  useEffect(() => {
    if (!autoStart || !address || isTourCompleted(address)) return
    const t = setTimeout(() => { void startTour() }, 800)
    return () => clearTimeout(t)
  }, [autoStart, address, startTour])

  useEffect(() => () => driverRef.current?.destroy(), [])

  return { startTour }
}
