'use client'

import { useWallet } from '@/features/wallet'
import { useOnboardingTour } from '@/hooks/use-onboarding-tour'

/**
 * Mounted once in the root layout. It renders nothing visible — the
 * step-by-step tooltip overlay is injected by driver.js when a wallet
 * connects for the first time.
 */
export function OnboardingTour() {
  const { address } = useWallet()
  useOnboardingTour({ autoStart: true, address })
  return null
}
