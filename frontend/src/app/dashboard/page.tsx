'use client'

import Link from 'next/link'

import { useWallet } from '@/hooks/use-wallet'
import { getConfig } from '@/config/env'
import { usePolicies } from '@/features/policies/hooks/usePolicies'
import { useClaimsData } from '@/lib/hooks/useClaimsData'
import { DEFAULT_FILTERS } from '@/components/claims/types'
import { ProtocolStatsWidget } from '@/components/dashboard/ProtocolStatsWidget'
import { EmptyDashboardState } from '@/components/dashboard/EmptyDashboardState'
import { Button } from '@/components/ui/button'

export default function DashboardPage() {
  const { address } = useWallet()
  const { network } = getConfig()

  const { policies, loading: policiesLoading } = usePolicies(address ?? null, network, 'all', 'expiry')
  const { claims, loading: claimsLoading } = useClaimsData(DEFAULT_FILTERS, 1)

  const loading = Boolean(address) && (policiesLoading || claimsLoading)
  const isEmptyPortfolio = !loading && policies.length === 0 && claims.length === 0

  return (
    <main className="container mx-auto px-4 py-8 max-w-6xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Protocol-level metrics refresh automatically every 30 seconds.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/policies">My Policies</Link>
        </Button>
      </div>

      {isEmptyPortfolio ? <EmptyDashboardState /> : null}

      <ProtocolStatsWidget />
    </main>
  )
}
