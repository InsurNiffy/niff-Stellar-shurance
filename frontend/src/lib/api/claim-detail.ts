import { z } from 'zod'

export const ClaimMetadataSchema = z.object({
  id: z.number(),
  policyId: z.string(),
  creatorAddress: z.string(),
  status: z.enum(['pending', 'approved', 'paid', 'rejected', 'appeal', 'appeal_approved', 'appeal_rejected', 'withdrawn']),
  amount: z.string(),
  description: z.string().optional(),
  evidenceHash: z.string(),
  createdAtLedger: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const VoteTalliesSchema = z.object({
  yesVotes: z.number(),
  noVotes: z.number(),
  totalVotes: z.number(),
})

export const QuorumSchema = z.object({
  required: z.number(),
  current: z.number(),
  percentage: z.number(),
  reached: z.boolean(),
  quorum_progress_pct: z.number(),
  votes_needed: z.number(),
})

export const DeadlineSchema = z.object({
  votingDeadlineLedger: z.number(),
  votingDeadlineTime: z.string(),
  isOpen: z.boolean(),
  remainingSeconds: z.number().nullable(),
  deadline_estimate_utc: z.string(),
})

export const ClaimEvidenceSchema = z.object({
  gatewayUrl: z.string().url(),
  hash: z.string(),
})

export const ConsistencyMetadataSchema = z.object({
  isFinalized: z.boolean(),
  indexerLag: z.number().optional(),
  lastIndexedLedger: z.number().optional(),
  isStale: z.boolean(),
})

export const ClaimStatusHistoryEntrySchema = z.object({
  status: z.enum(['pending', 'approved', 'paid', 'rejected', 'appeal', 'appeal_approved', 'appeal_rejected', 'withdrawn']),
  ledger: z.number(),
  timestamp: z.string(),
})

export const AppealInfoSchema = z.object({
  appealRound: z.number(),
  elevatedQuorumBps: z.number(),
  appealVotingDeadlineLedger: z.number(),
  appealVotingDeadlineTime: z.string().optional(),
})

export const DisputeInfoSchema = z.object({
  disputeDeadlineLedger: z.number().optional(),
  disputeDeadlineTime: z.string().optional(),
  disputeWindowOpen: z.boolean().optional(),
  remainingDisputeSeconds: z.number().nullable().optional(),
  disputeNote: z.string().optional(),
})

export const ClaimDetailResponseSchema = z.object({
  metadata: ClaimMetadataSchema,
  votes: VoteTalliesSchema,
  quorum: QuorumSchema,
  deadline: DeadlineSchema,
  dispute: DisputeInfoSchema,
  appeal: AppealInfoSchema.optional(),
  evidence: ClaimEvidenceSchema,
  consistency: ConsistencyMetadataSchema,
  status_history: z.array(ClaimStatusHistoryEntrySchema),
  voter_eligible: z.boolean(),
  userHasVoted: z.boolean().optional(),
  userVote: z.enum(['yes', 'no']).optional(),
  payout_deadline_ledger: z.number().optional(),
  fraud_score: z.number().optional(),
  /** Whether an appeal has been submitted for this claim. */
  appeal_submitted: z.boolean().optional(),
})

export type DisputeInfo = z.infer<typeof DisputeInfoSchema>

export type AppealInfo = z.infer<typeof AppealInfoSchema>

export type ClaimDetailResponse = z.infer<typeof ClaimDetailResponseSchema>

export const ClaimVoterSchema = z.object({
  walletAddress: z.string(),
  displayName: z.string().optional(),
  voted: z.boolean(),
  vote: z.enum(['yes', 'no']).optional(),
})

export type ClaimVoter = z.infer<typeof ClaimVoterSchema>

export async function fetchClaimVoters(claimId: string): Promise<ClaimVoter[]> {
  const response = await fetch(`/api/claims/${encodeURIComponent(claimId)}/voters`)
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ message: 'Failed to load voters' }))
    throw new Error(errorBody.message ?? 'Failed to load voters')
  }
  const data = await response.json()
  return z.array(ClaimVoterSchema).parse(data)
}

export async function fetchClaimDetail(claimId: string): Promise<ClaimDetailResponse> {
  const response = await fetch(`/api/claims/${encodeURIComponent(claimId)}`)
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ message: 'Failed to load claim details' }))
    throw new Error(errorBody.message ?? 'Failed to load claim details')
  }

  const data = await response.json()
  return ClaimDetailResponseSchema.parse(data)
}

// ── Timeline API ─────────────────────────────────────────────────────────────

export const ClaimTimelineEntrySchema = z.object({
  status: z.string(),
  ledger: z.number(),
  timestamp: z.string(),
  actor: z.string().nullable(),
  reason: z.string().nullable(),
})

export type ClaimTimelineEntry = z.infer<typeof ClaimTimelineEntrySchema>

export async function fetchClaimTimeline(claimId: string): Promise<ClaimTimelineEntry[]> {
  const response = await fetch(`/api/claims/${encodeURIComponent(claimId)}/timeline`)
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ message: 'Failed to load timeline' }))
    throw new Error(errorBody.message ?? 'Failed to load claim timeline')
  }
  const data = await response.json()
  return z.array(ClaimTimelineEntrySchema).parse(data)
}
