import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ClaimVotePanel } from '@/components/claims/claim-vote-panel'
import { getConfig } from '@/config/env'
import type { Claim } from '@/lib/schemas/vote'
import { ClaimSchema } from '@/lib/schemas/vote'
import { PrintButton } from '@/components/ui/print-button'

interface ClaimPageProps {
  params: Promise<{ id: string }>
}

async function fetchClaimForMeta(id: string): Promise<Claim | null> {
  try {
    const { apiUrl } = getConfig()
    const res = await fetch(`${apiUrl}/api/claims/${encodeURIComponent(id)}`, {
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
  const { id } = await params
  const claim = await fetchClaimForMeta(id)

  if (!claim) {
    return {
      title: 'Claim Not Found',
      description: 'The requested claim could not be found.',
    }
  }

  const title = `Claim ${id} — ${claim.status}`
  const description = `Insurance claim ${id} is currently ${claim.status}. Review claim details and community voting status.`

  return {
    title,
    description,
    alternates: {
      canonical: `/claims/${id}`,
    },
    openGraph: {
      title,
      description: `Claim status: ${claim.status}. View claim details and voting status.`,
      type: 'website',
    },
  }
}

/**
 * /claims/[id] — server component.
 *
 * Renders claim metadata server-side for shareable deep links and SEO.
 * Wallet connection and eligibility checks happen client-side in ClaimVotePanel.
 */
export default async function ClaimPage({ params }: ClaimPageProps) {
  const { id } = await params

  const claim = await fetchClaimForMeta(id)
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
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold" data-tour="file-claim">
          Claim vote — <span className="font-mono text-base">{id}</span>
        </h1>
        <PrintButton />
      </div>
      <ClaimVotePanel claimId={id} />
    </main>
  )
}
