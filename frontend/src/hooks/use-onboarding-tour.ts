'use client'

import { useCallback, useEffect, useRef } from 'react'

const TOUR_COMPLETED_KEY = 'niffyinsur-tour-completed'
const TOUR_PROGRESS_KEY = 'niffyinsur-tour-progress'

export interface TourStep {
  element: string
  popover: { title: string; description: string; side?: 'top' | 'bottom' | 'left' | 'right' }
}

const TOUR_STEPS: TourStep[] = [
  {
    element: '[data-tour="connect-wallet"]',
    popover: {
      title: 'Connect your wallet',
      description: 'Start by connecting your Stellar wallet (Freighter or xBull) to access all features.',
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="view-policies"]',
    popover: {
      title: 'View your policies',
      description: 'See all your active insurance policies, coverage details, and expiry countdowns.',
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="file-claim"]',
    popover: {
      title: 'File a claim',
      description: 'Submit a claim with evidence when a covered event occurs. The DAO will vote on it.',
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="cast-vote"]',
    popover: {
      title: 'Cast a vote',
      description: 'Governance token holders vote to approve or reject claims transparently on-chain.',
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="support"]',
    popover: {
      title: 'Get support',
      description: 'Search FAQs, submit a support ticket, and review your ticket history here.',
      side: 'bottom',
    },
  },
]

export function isTourCompleted(): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(TOUR_COMPLETED_KEY) === 'true'
}

export function resetTour(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(TOUR_COMPLETED_KEY)
    localStorage.removeItem(TOUR_PROGRESS_KEY)
  }
}

export function useOnboardingTour({ autoStart = true }: { autoStart?: boolean } = {}) {
  const driverRef = useRef<{ drive: () => void; destroy: () => void } | null>(null)

  const startTour = useCallback(async () => {
    // Dynamically import driver.js to avoid SSR issues
    const { driver } = await import('driver.js')
    await import('driver.js/dist/driver.css')

    const availableSteps = TOUR_STEPS.filter((step) => document.querySelector(step.element))
    const d = driver({
      animate: true,
      showProgress: true,
      progressText: '{{current}} of {{total}}',
      steps: availableSteps,
      keyboardControl: true,
      allowClose: true,
      onNext: () => {
        localStorage.setItem(TOUR_PROGRESS_KEY, String(Math.min(5, (Number(localStorage.getItem(TOUR_PROGRESS_KEY) ?? '0')) + 1)))
      },
      onPrev: () => {
        localStorage.setItem(TOUR_PROGRESS_KEY, String(Math.max(0, Number(localStorage.getItem(TOUR_PROGRESS_KEY) ?? '0') - 1)))
      },
      onDestroyed: () => {
        localStorage.setItem(TOUR_COMPLETED_KEY, 'true')
        localStorage.removeItem(TOUR_PROGRESS_KEY)
      },
      onDestroyStarted: () => {
        d.destroy()
      },
    })

    driverRef.current = d
    d.drive()
  }, [])

  // Auto-start on first visit
  useEffect(() => {
    if (autoStart && !isTourCompleted()) {
      // Small delay so the page has rendered its tour targets
      const t = setTimeout(() => startTour(), 800)
      return () => clearTimeout(t)
    }
  }, [autoStart, startTour])

  return { startTour }
}
