import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getConfig } from '@/config/env'
import { PolicyDtoSchema, type PolicyDto } from '@/features/policies/api'

interface PolicyPageProps {
  params: Promise<{ id: string }>
}

async function fetchPolicyById(id: string): Promise<PolicyDto | null> {
  try {
    const { apiUrl } = getConfig()
    // Public policy lookup by ID — no wallet address required for SSR
    const res = await fetch(`${apiUrl}/api/policies/${encodeURIComponent(id)}`, {
      next: { revalidate: 60 },
    })
    if (res.status === 404) return null
    if (!res.ok) return null
    const data = await res.json()
    const parsed = PolicyDtoSchema.safeParse(data)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: PolicyPageProps): Promise<Metadata> {
  const { id } = await params
  const policy = await fetchPolicyById(id)

  if (!policy) {
    return {
      title: 'Policy Not Found',
      description: 'The requested policy could not be found.',
    }
  }

  const title = `Policy #${policy.policy_id} — ${policy.policy_type} (${policy.region})`
  // Description intentionally omits wallet addresses and sensitive data
  const description = `${policy.policy_type} insurance policy in ${policy.region} risk region. Status: ${policy.is_active ? 'Active' : 'Expired'}.`

  return {
    title,
    description,
    alternates: {
      canonical: `/policies/${id}`,
    },
    openGraph: {
      title,
      // OG description must not include wallet addresses or sensitive claim details
      description: `${policy.policy_type} policy · ${policy.region} risk · ${policy.is_active ? 'Active' : 'Expired'}`,
      type: 'website',
    },
  }
}

/**
 * /policies/[id] — server-rendered deep link page.
 *
 * Renders policy details without requiring wallet connection.
 * Wallet-specific data (holder address, beneficiary) is not included
 * in the server-rendered HTML to avoid exposing sensitive data.
 */
export default async function PolicyDeepLinkPage({ params }: PolicyPageProps) {
  const { id } = await params
  const policy = await fetchPolicyById(id)

  if (!policy) {
    notFound()
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/policies"
          className="text-sm text-blue-600 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
          aria-label="Back to policies list"
        >
          ← Policies
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-gray-900">
        Policy #{policy.policy_id}
      </h1>

      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <p className="text-gray-500">Type</p>
            <p className="font-medium">{policy.policy_type}</p>
          </div>
          <div>
            <p className="text-gray-500">Risk region</p>
            <p className="font-medium">{policy.region}</p>
          </div>
          <div>
            <p className="text-gray-500">Status</p>
            <p className={policy.is_active ? 'text-green-700 font-medium' : 'text-gray-500'}>
              {policy.is_active ? 'Active' : 'Expired'}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Coverage</p>
            <p className="font-mono">{policy.coverage_summary.coverage_amount} stroops</p>
          </div>
          <div>
            <p className="text-gray-500">Premium</p>
            <p className="font-mono">{policy.coverage_summary.premium_amount} stroops / yr</p>
          </div>
        </div>

        <div className="pt-2 flex gap-3">
          <Link
            href="/quote"
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
          >
            Get a new quote
          </Link>
        </div>
      </div>
    </main>
  )
}
