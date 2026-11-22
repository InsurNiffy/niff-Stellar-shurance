import type { AuditEntry } from '@/lib/api/admin'

export interface GovernanceAuditProposal {
  id: string
  actionType: string
  proposer: string
  timestamp: string
  status: string
  title: string
  payload: Record<string, unknown>
  eventUrl: string | null
}

const PARAMETER_ACTION = /(param|config|quorum|vot(e|ing)|fee|governance|setting|deploy|upgrade)/i
const META_ACTION = /audit_log_read/i

function getPayloadValue(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value
    if (typeof value === 'number') return String(value)
  }
  return null
}

function deriveStatus(entry: AuditEntry): string {
  const payload = entry.payload ?? {}
  const explicit = getPayloadValue(payload, ['status', 'state', 'proposalStatus'])
  if (explicit) return explicit
  const action = entry.action.toLowerCase()
  if (/execut|appl|enact/.test(action)) return 'executed'
  if (/reject|deny|veto/.test(action)) return 'rejected'
  if (/pass|approve/.test(action)) return 'passed'
  if (/creat|propos|submi|pending/.test(action)) return 'pending'
  return 'recorded'
}

function onChainEventUrl(payload: Record<string, unknown>): string | null {
  const hash = getPayloadValue(payload, ['txHash', 'transactionHash', 'hash', 'eventId', 'tx'])
  if (!hash) return null
  return `https://stellar.expert/explorer/public/tx/${encodeURIComponent(hash)}`
}

function humanize(action: string): string {
  return action
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Converts admin audit entries into the governance proposal view model.
 * Parameter-change audits are identified either by their action name or by
 * the presence of parameter fields in their payload.
 */
export function auditEntriesToProposals(entries: AuditEntry[]): GovernanceAuditProposal[] {
  return entries
    .filter((entry) => {
      if (META_ACTION.test(entry.action)) return false
      const payload = entry.payload ?? {}
      const hasParameterFields = ['parameterKey', 'paramKey', 'oldValue', 'newValue', 'proposedValue']
        .some((key) => key in payload)
      return PARAMETER_ACTION.test(entry.action) || hasParameterFields
    })
    .map((entry) => {
      const payload = entry.payload ?? {}
      return {
        id: getPayloadValue(payload, ['proposalId', 'id']) ?? entry.id,
        actionType: humanize(entry.action),
        proposer: entry.actor,
        timestamp: entry.createdAt,
        status: deriveStatus(entry),
        title: getPayloadValue(payload, ['title', 'proposalTitle'])
          ?? getPayloadValue(payload, ['parameterKey', 'paramKey'])
          ?? humanize(entry.action),
        payload,
        eventUrl: onChainEventUrl(payload),
      }
    })
}
