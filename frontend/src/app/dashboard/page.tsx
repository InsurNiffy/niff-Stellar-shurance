'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { EmptyDashboardState } from '@/components/dashboard/EmptyDashboardState'
import { DraggableDashboardCards } from '@/components/dashboard/DraggableDashboardCards'
import { ProtocolStatsWidget } from '@/components/dashboard/ProtocolStatsWidget'
import { useWallet, useWalletBalances } from '@/features/wallet'
import { fetchPolicies } from '@/features/policies/api'
import { getConfig } from '@/config/env'

interface ClaimSummary {
  id: string
  status?: string
}

async function fetchDashboardClaims(address: string): Promise<ClaimSummary[]> {
  const { apiUrl } = getConfig()
  const res = await fetch(`${apiUrl}/api/claims?claimant=${encodeURIComponent(address)}&limit=100`)
  if (!res.ok) return []
  const data = (await res.json()) as { claims?: ClaimSummary[] }
  return data.claims ?? []
}

function countActivePolicies(result: Awaited<ReturnType<typeof fetchPolicies>> | undefined): number {
  if (!result) return 0
  return result.data.filter((policy) => {
    const status = String((policy as { status?: unknown }).status ?? 'active').toLowerCase()
    return status === 'active' || status === 'issued'
  }).length
}

function WalletBalanceCard({ address }: { address: string | null }) {
  const { data, isLoading } = useWalletBalances(address)
  const xlm = data?.find((balance) => balance.asset === 'XLM')
  return (
    <section className="rounded-lg border bg-card p-4" aria-label="Wallet balance card">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Wallet balance</p>
      {isLoading ? (
        <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
      ) : xlm ? (
        <p className="mt-2 text-2xl font-semibold tabular-nums">{Number(xlm.balance).toFixed(2)} XLM</p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No balance available</p>
      )}
    </section>
  )
}

export default function DashboardPage() {
  const { address } = useWallet()

  const policiesQuery = useQuery({
    queryKey: ['dashboard-policies', address],
    queryFn: () => fetchPolicies({ holder: address! }),
    enabled: !!address,
  })

  const claimsQuery = useQuery({
    queryKey: ['dashboard-claims', address],
    queryFn: () => fetchDashboardClaims(address!),
    enabled: !!address,
  })

  if (!address) {
    return (
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <EmptyDashboardState />
        <div className="text-center">
          <Button asChild variant="outline">
            <Link href="/quote">Get a quote</Link>
          </Button>
        </div>
      </main>
    )
  }

  const policies = policiesQuery.data
  const claims = claimsQuery.data ?? []
  const activePolicies = countActivePolicies(policies)
  const openClaims = claims.filter((claim) =>
    ['open', 'pending', 'voting', 'submitted'].includes(String(claim.status ?? '').toLowerCase()),
  ).length
  const pendingVotes = claims.filter((claim) =>
    ['voting', 'pending', 'open'].includes(String(claim.status ?? '').toLowerCase()),
  ).length

  const showEmptyPortfolio =
    !policiesQuery.isLoading && activePolicies === 0 && openClaims === 0

  if (showEmptyPortfolio) {
    return (
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <EmptyDashboardState />
      </main>
    )
  }

  const cards = [
    {
      id: 'active-policies',
      label: 'Active policies',
      content: (
        <section className="rounded-lg border bg-card p-4" aria-label="Active policies card">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Active policies</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{activePolicies}</p>
          <Button asChild variant="link" size="sm" className="mt-1 px-0">
            <Link href="/policies">View policies</Link>
          </Button>
        </section>
      ),
    },
    {
      id: 'open-claims',
      label: 'Open claims',
      content: (
        <section className="rounded-lg border bg-card p-4" aria-label="Open claims card">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Open claims</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{openClaims}</p>
          <Button asChild variant="link" size="sm" className="mt-1 px-0">
            <Link href="/claims">View claims</Link>
          </Button>
        </section>
      ),
    },
    {
      id: 'pending-votes',
      label: 'Pending votes',
      content: (
        <section className="rounded-lg border bg-card p-4" aria-label="Pending votes card">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Pending votes</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{pendingVotes}</p>
          <Button asChild variant="link" size="sm" className="mt-1 px-0">
            <Link href="/governance">Go to governance</Link>
          </Button>
        </section>
      ),
    },
    {
      id: 'wallet-balance',
      label: 'Wallet balance',
      content: <WalletBalanceCard address={address} />,
    },
  ]

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8" data-tour="policy-dashboard">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your portfolio and protocol overview.</p>
      </div>
      <ProtocolStatsWidget />
      <DraggableDashboardCards cards={cards} />
    </main>
  )
}
