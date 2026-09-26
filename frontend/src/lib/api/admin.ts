import { apiFetch } from './fetch'
import { getConfig } from '@/config/env'

function base() {
  return `${getConfig().apiUrl}/admin`
}

function authHeaders(jwt: string) {
  return { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }
}

// ── Governance Types ────────────────────────────────────────────────────────

export interface RegisteredVoter {
  walletAddress: string
  displayName?: string | null
  registeredBy: string
  registeredAt: string
}

export interface QuorumSettings {
  quorum_bps: number
}

export interface QuorumUpdateResult {
  quorum_bps: number
  unsignedXdr: string
}

export interface QuorumImpact {
  totalActiveClaims: number
  affectedClaims: Array<{
    claimId: number
    currentQuorumBps: number
    newQuorumBps: number
    eligibleVoters: number
    currentRequired: number
    newRequired: number
    status: string
  }>
  quorumBps: number | null
}

export interface OperatorDelegation {
  id: string
  delegate: string
  expiryLedger: number
  ledgersRemaining: number
  grantedBy: string
  grantedAt: string
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

export type AdminClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID'

export interface AdminClaim {
  id: number
  policyId: string
  creatorAddress: string
  status: AdminClaimStatus
  amount: string
  description?: string
  createdAt: string
  updatedAt: string
}

export interface AdminClaimsPage {
  items: AdminClaim[]
  total: number
  nextCursor?: string
}

export interface BulkUpdateDryRunResult {
  affectedClaims: AdminClaim[]
  totalAffected: number
}

export interface BulkUpdateResult {
  updated: number
}

export interface AllowedAsset {
  id: string
  contractId: string
  symbol: string
  decimals: number
  isAllowed: boolean
}

export interface AddAssetParams {
  contractId: string
  symbol: string
  decimals: number
}

// ── Governance Proposal Types ─────────────────────────────────────────────────

export type ProposalStatus = 'active' | 'passed' | 'rejected' | 'executed'

export interface GovernanceProposal {
  id: string
  title: string
  description: string
  proposer: string
  status: ProposalStatus
  parameterKey: string
  currentValue: string
  proposedValue: string
  yesVotes: number
  noVotes: number
  quorumRequired: number
  createdAt: string
  votingDeadline: string
}

export interface CreateProposalParams {
  title: string
  description: string
  parameterKey: string
  proposedValue: string
}

export interface EvidenceLimits {
  minEvidenceCount: number
  maxEvidenceCount: number
}

export interface KeeperActionResult {
  success: boolean
  message: string
  txHash: string
}

export interface TransactionBuildResult {
  unsignedXdr: string
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

  getAudits: (jwt: string, params: { cursor?: string; limit?: number; action?: string; actor?: string; dateFrom?: string; dateTo?: string }) => {
    const q = new URLSearchParams()
    if (params.cursor) q.set('cursor', params.cursor)
    if (params.limit) q.set('limit', String(params.limit))
    if (params.action) q.set('action', params.action)
    if (params.actor) q.set('actor', params.actor)
    if (params.dateFrom) q.set('dateFrom', params.dateFrom)
    if (params.dateTo) q.set('dateTo', params.dateTo)
    return apiFetch<AuditPage>(`${base()}/audits?${q}`, { headers: authHeaders(jwt) })
  },

  exportAuditsUrl: (jwt: string, action?: string, actor?: string, dateFrom?: string, dateTo?: string) => {
    const q = new URLSearchParams()
    if (action) q.set('action', action)
    if (actor) q.set('actor', actor)
    if (dateFrom) q.set('dateFrom', dateFrom)
    if (dateTo) q.set('dateTo', dateTo)
    return `${base()}/audits/export?${q}`
  },

  triggerReindex: (jwt: string, fromLedger: number, network: string) =>
    apiFetch<{ jobId: string; status: string }>(`${base()}/reindex`, {
      method: 'POST',
      headers: authHeaders(jwt),
      body: JSON.stringify({ fromLedger, network }),
    }),

  getClaims: (jwt: string, params: { cursor?: string; limit?: number; search?: string; status?: AdminClaimStatus }) => {
    const q = new URLSearchParams()
    if (params.cursor) q.set('cursor', params.cursor)
    if (params.limit) q.set('limit', String(params.limit))
    if (params.search) q.set('search', params.search)
    if (params.status) q.set('status', params.status)
    return apiFetch<AdminClaimsPage>(`${base()}/claims?${q}`, { headers: authHeaders(jwt) })
  },

  overrideClaimStatus: (jwt: string, claimId: number, status: AdminClaimStatus, reason: string) =>
    apiFetch<AdminClaim>(`${base()}/claims/${claimId}/override`, {
      method: 'POST',
      headers: authHeaders(jwt),
      body: JSON.stringify({ status, reason }),
    }),

  bulkUpdateClaims: (jwt: string, claimIds: number[], status: AdminClaimStatus, dryRun: boolean) =>
    apiFetch<BulkUpdateDryRunResult | BulkUpdateResult>(`${base()}/claims/bulk-update`, {
      method: 'POST',
      headers: authHeaders(jwt),
      body: JSON.stringify({ claimIds, status, dryRun }),
    }),

  listAssets: (jwt: string) =>
    apiFetch<AllowedAsset[]>(`${base()}/assets`, { headers: authHeaders(jwt) }),

  addAsset: (jwt: string, params: AddAssetParams) =>
    apiFetch<AllowedAsset>(`${base()}/assets`, {
      method: 'POST',
      headers: authHeaders(jwt),
      body: JSON.stringify(params),
    }),

  setAssetAllowed: (jwt: string, id: string, isAllowed: boolean) =>
    apiFetch<AllowedAsset>(`${base()}/assets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: authHeaders(jwt),
      body: JSON.stringify({ isAllowed }),
    }),

  removeAsset: (jwt: string, id: string) =>
    apiFetch<void>(`${base()}/assets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders(jwt),
    }),

  listProposals: (jwt: string) =>
    apiFetch<GovernanceProposal[]>(`${base()}/governance/proposals`, {
      headers: authHeaders(jwt),
    }),

  createProposal: (jwt: string, params: CreateProposalParams) =>
    apiFetch<GovernanceProposal>(`${base()}/governance/proposals`, {
      method: 'POST',
      headers: authHeaders(jwt),
      body: JSON.stringify(params),
    }),

  getQuorum: (jwt: string) =>
    apiFetch<QuorumSettings>(`${base()}/governance/quorum`, {
      headers: authHeaders(jwt),
    }),

  getQuorumImpact: (jwt: string, quorumBps: number) =>
    apiFetch<QuorumImpact>(`${base()}/governance/quorum/impact?quorum_bps=${quorumBps}`, {
      headers: authHeaders(jwt),
    }),

  setQuorum: (jwt: string, quorumBps: number) =>
    apiFetch<QuorumUpdateResult>(`${base()}/governance/quorum`, {
      method: 'PUT',
      headers: authHeaders(jwt),
      body: JSON.stringify({ quorum_bps: quorumBps }),
    }),

  listVoters: (jwt: string) =>
    apiFetch<RegisteredVoter[]>(`${base()}/governance/voters`, {
      headers: authHeaders(jwt),
    }),

  removeVoter: (jwt: string, walletAddress: string) =>
    apiFetch<void>(`${base()}/governance/voters/${encodeURIComponent(walletAddress)}`, {
      method: 'DELETE',
      headers: authHeaders(jwt),
    }),

  batchRegisterVoters: (jwt: string, addresses: string[]) =>
    apiFetch<TransactionBuildResult>(`${base()}/governance/voters/batch`, {
      method: 'POST',
      headers: authHeaders(jwt),
      body: JSON.stringify({ addresses }),
    }),

  listDelegations: (jwt: string) =>
    apiFetch<OperatorDelegation[]>(`${base()}/delegations`, {
      headers: authHeaders(jwt),
    }),

  grantDelegation: (jwt: string, params: { delegate: string; expiryLedger: number }) =>
    apiFetch<OperatorDelegation>(`${base()}/delegations`, {
      method: 'POST',
      headers: authHeaders(jwt),
      body: JSON.stringify(params),
    }),

  revokeDelegation: (jwt: string, id: string) =>
    apiFetch<void>(`${base()}/delegations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders(jwt),
    }),

  getEvidenceLimits: (jwt: string) =>
    apiFetch<EvidenceLimits>(`${base()}/evidence/limits`, {
      headers: authHeaders(jwt),
    }),

  setEvidenceLimits: (jwt: string, minEvidenceCount: number, maxEvidenceCount: number) =>
    apiFetch<KeeperActionResult>(`${base()}/evidence/limits`, {
      method: 'PUT',
      headers: authHeaders(jwt),
      body: JSON.stringify({ minEvidenceCount, maxEvidenceCount }),
    }),
}
