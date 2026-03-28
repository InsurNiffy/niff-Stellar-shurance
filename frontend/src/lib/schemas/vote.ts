import { z } from 'zod'

export const ClaimStatusSchema = z.enum([
  'Processing',
  'Pending',
  'Approved',
  'Paid',
  'Rejected',
  'Withdrawn',
])
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>

export const VoteOptionSchema = z.enum(['Approve', 'Reject'])
export type VoteOption = z.infer<typeof VoteOptionSchema>

export const ClaimSchema = z.object({
  claim_id: z.string(),
  policy_id: z.string(),
  claimant: z.string(),
  amount: z.string(),
  details: z.string(),
  image_urls: z.array(z.string()),
  status: ClaimStatusSchema,
  voting_deadline_ledger: z.number(),
  approve_votes: z.number(),
  reject_votes: z.number(),
  filed_at: z.number(),
  total_voters: z.number(),
  /** Per-claim snapshot from contract `get_claim_quorum_bps`; omit ⇒ use DEFAULT_QUORUM_BPS for display. */
  quorum_bps: z.number().int().min(1).max(10_000).optional(),
})
export type Claim = z.infer<typeof ClaimSchema>

export const VoteRequestSchema = z.object({
  claimId: z.string().min(1),
  vote: VoteOptionSchema,
  walletAddress: z.string().regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar address'),
})
export type VoteRequest = z.infer<typeof VoteRequestSchema>

export const VoteResponseSchema = z.object({
  transactionHash: z.string(),
  status: ClaimStatusSchema,
  approve_votes: z.number(),
  reject_votes: z.number(),
})
export type VoteResponse = z.infer<typeof VoteResponseSchema>

export const EligibilitySchema = z.object({
  eligible: z.boolean(),
  reason: z.string().optional(),
  priorVote: VoteOptionSchema.nullable(),
})
export type Eligibility = z.infer<typeof EligibilitySchema>

// VOTE_WINDOW_LEDGERS from on-chain types.rs (re-exported constant)
// 1 ledger ≈ 5 s → 7 days ≈ 120_960 ledgers
export const VOTE_WINDOW_LEDGERS = 120_960
export const SECS_PER_LEDGER = 5

/** Default 50% participation; must match `types::DEFAULT_QUORUM_BPS` on-chain. */
export const DEFAULT_QUORUM_BPS = 5000
export const QUORUM_BPS_DENOMINATOR = 10_000

/**
 * Minimum cast ballots (approve + reject) required before an outcome is valid.
 * Matches on-chain `required_cast_for_quorum`: ceil(eligible * quorumBps / 10_000).
 */
export function requiredBallotsForQuorum(eligible: number, quorumBps: number): number {
  if (eligible <= 0) return 0
  const n = eligible * quorumBps
  return Math.ceil(n / QUORUM_BPS_DENOMINATOR)
}

export function ledgersToMs(ledgers: number): number {
  return ledgers * SECS_PER_LEDGER * 1000
}

/**
 * Approximate wall-clock ms remaining in the voting window, using the on-chain
 * `voting_deadline_ledger` from the claim (not the live protocol config).
 * Inclusive deadline: voting is allowed while `currentLedger <= votingDeadlineLedger`.
 */
export function deadlineMs(votingDeadlineLedger: number, currentLedger: number): number {
  if (currentLedger > votingDeadlineLedger) return 0
  const ledgersRemaining = votingDeadlineLedger - currentLedger + 1
  return ledgersRemaining * SECS_PER_LEDGER * 1000
}

/** Matches contract `is_claim_voting_open` — inclusive of `voting_deadline_ledger`. */
export function isVoteOpen(votingDeadlineLedger: number, currentLedger: number): boolean {
  return currentLedger <= votingDeadlineLedger
}

export function isTerminal(status: ClaimStatus): boolean {
  return (
    status === 'Approved' ||
    status === 'Paid' ||
    status === 'Rejected' ||
    status === 'Withdrawn'
  )
}
