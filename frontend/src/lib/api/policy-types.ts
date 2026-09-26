import { getConfig } from '@/config/env'

export interface PolicyTypeOption {
  id: string
  label: string
  description: string
  icon?: string
}

export async function fetchPolicyTypes(signal?: AbortSignal): Promise<PolicyTypeOption[]> {
  const { apiUrl } = getConfig()
  const res = await fetch(`${apiUrl}/assets/allowed`, { signal })

  if (!res.ok) {
    return [
      { id: 'Auto', label: 'Auto', description: 'Vehicle and automotive coverage' },
      { id: 'Health', label: 'Health', description: 'Health and medical coverage' },
      { id: 'Property', label: 'Property', description: 'Property and real estate coverage' },
    ]
  }

  const data: unknown = await res.json()
  if (Array.isArray(data)) {
    return data.map((item: Record<string, unknown>) => ({
      id: String(item.id ?? item.name ?? ''),
      label: String(item.label ?? item.name ?? item.id ?? ''),
      description: String(item.description ?? ''),
      icon: item.icon ? String(item.icon) : undefined,
    }))
  }

  return [
    { id: 'Auto', label: 'Auto', description: 'Vehicle and automotive coverage' },
    { id: 'Health', label: 'Health', description: 'Health and medical coverage' },
    { id: 'Property', label: 'Property', description: 'Property and real estate coverage' },
  ]
}
