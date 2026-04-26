import { apiFetch } from './fetch'
import { getConfig } from '@/config/env'

function base() {
  return `${getConfig().apiUrl}/admin`
}

function authHeaders(jwt: string) {
  return { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface SolvencySnapshot {
  totalPremiumReserve: string
  totalExposure: string
  solvencyRatio: number
  capturedAt: string
}

export interface FeatureFlag {
  key: string
  enabled: boolean
  description?: string
}

export interface AuditEntry {
  id: string
  actor: string
  action: string
  payload: Record<string, unknown>
  ipAddress?: string
  createdAt: string
}

export interface AuditPage {
  items: AuditEntry[]
  nextCursor?: string
}

export interface QueueStatus {
  name: string
  waiting: number
  active: number
  failed: number
}

// ── API calls ──────────────────────────────────────────────────────────────

export const adminApi = {
  getSolvency: (jwt: string) =>
    apiFetch<{ snapshot: SolvencySnapshot | null }>(`${base()}/solvency`, {
      headers: authHeaders(jwt),
    }),

  listFeatureFlags: (jwt: string) =>
    apiFetch<FeatureFlag[]>(`${base()}/feature-flags`, {
      headers: authHeaders(jwt),
    }),

  setFeatureFlag: (jwt: string, key: string, enabled: boolean) =>
    apiFetch<FeatureFlag>(`${base()}/feature-flags/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      headers: authHeaders(jwt),
      body: JSON.stringify({ enabled }),
    }),

  getAudits: (jwt: string, params: { cursor?: string; limit?: number; action?: string; actor?: string }) => {
    const q = new URLSearchParams()
    if (params.cursor) q.set('cursor', params.cursor)
    if (params.limit) q.set('limit', String(params.limit))
    if (params.action) q.set('action', params.action)
    if (params.actor) q.set('actor', params.actor)
    return apiFetch<AuditPage>(`${base()}/audits?${q}`, { headers: authHeaders(jwt) })
  },

  exportAuditsUrl: (jwt: string, action?: string, actor?: string) => {
    const q = new URLSearchParams()
    if (action) q.set('action', action)
    if (actor) q.set('actor', actor)
    return `${base()}/audits/export?${q}`
  },

  triggerReindex: (jwt: string, fromLedger: number, network: string) =>
    apiFetch<{ jobId: string; status: string }>(`${base()}/reindex`, {
      method: 'POST',
      headers: authHeaders(jwt),
      body: JSON.stringify({ fromLedger, network }),
    }),
}
