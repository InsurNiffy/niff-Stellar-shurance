import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ClaimVotePanel } from '@/components/claims/claim-vote-panel'
import { getConfig } from '@/config/env'
import type { Claim } from '@/lib/schemas/vote'
import { ClaimSchema } from '@/lib/schemas/vote'

interface ClaimPageProps {
  params: Promise<{ claimId: string }>
}

async function fetchClaimForMeta(claimId: string): Promise<Claim | null> {
  try {
    const { apiUrl } = getConfig()
    const res = await fetch(`${apiUrl}/api/claims/${claimId}`, {
      next: { revalidate: 60 },
    })
    if (res.status === 404) return null
    if (!res.ok) return null
    const data = await res.json()
    return ClaimSchema.parse(data)
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: ClaimPageProps): Promise<Metadata> {
  const { claimId } = await params
  const claim = await fetchClaimForMeta(claimId)

  if (!claim) {
    return {
      title: 'Claim Not Found',
      description: 'The requested claim could not be found.',
    }
  }

  const title = `Claim ${claimId} — ${claim.status}`
  const description = `Vote on claim ${claimId}. Current status: ${claim.status}. Approve votes: ${claim.approve_votes}, Reject votes: ${claim.reject_votes}.`

  return {
    title,
    description,
    // Canonical URL prevents duplicate content from query params
    alternates: {
      canonical: `/claims/${claimId}`,
    },
    openGraph: {
      title,
      // Description intentionally omits wallet addresses and sensitive claim details
      description: `Claim status: ${claim.status}. Cast your vote on this insurance claim.`,
      type: 'website',
    },
  }
}

/**
 * /claims/[claimId] — server component.
 *
 * Fetches claim metadata server-side for SEO/OG without exposing
 * wallet-specific data in the initial HTML. Wallet connection and
 * eligibility checks happen client-side in ClaimVotePanel.
 */
export default async function ClaimPage({ params }: ClaimPageProps) {
  const { claimId } = await params

  // Validate the claim exists; show 404 for unknown IDs
  const claim = await fetchClaimForMeta(claimId)
  if (!claim) {
    notFound()
  }

  return (
    <main
      className="mx-auto max-w-2xl px-4 py-10 pb-[calc(2.5rem+env(safe-area-inset-bottom,0px))]"
      style={{
        paddingLeft: 'max(1rem, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(1rem, env(safe-area-inset-right, 0px))',
      }}
    >
      <h1 className="mb-6 text-xl font-bold">
        Claim vote — <span className="font-mono text-base">{claimId}</span>
      </h1>
      <ClaimVotePanel claimId={claimId} />
    </main>
  )
}
