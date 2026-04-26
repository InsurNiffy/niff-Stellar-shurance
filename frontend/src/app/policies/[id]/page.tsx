import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getConfig } from '@/config/env'
import { PolicyDtoSchema, type PolicyDto } from '@/features/policies/api'
import { PolicyDetailClient } from '@/features/policies/components/PolicyDetailClient'

interface PolicyPageProps {
  params: Promise<{ id: string }>
}

async function fetchPolicyById(id: string): Promise<PolicyDto | null> {
  try {
    const { apiUrl } = getConfig()
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
  const description = `${policy.policy_type} insurance policy in ${policy.region} risk region. Status: ${policy.is_active ? 'Active' : 'Expired'}.`

  return {
    title,
    description,
    alternates: {
      canonical: `/policies/${id}`,
    },
    openGraph: {
      title,
      description: `${policy.policy_type} policy · ${policy.region} risk · ${policy.is_active ? 'Active' : 'Expired'}`,
      type: 'website',
    },
  }
}

export default async function PolicyDeepLinkPage({ params }: PolicyPageProps) {
  const { id } = await params
  const policy = await fetchPolicyById(id)

  if (!policy) {
    notFound()
  }

  return <PolicyDetailClient initialPolicy={policy} policyId={id} />
}
