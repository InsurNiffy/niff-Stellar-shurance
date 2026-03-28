'use client'

import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Claim,
  ClaimStatus,
  DEFAULT_QUORUM_BPS,
  deadlineMs,
  isTerminal,
  isVoteOpen,
  requiredBallotsForQuorum,
} from '@/lib/schemas/vote'

interface VoteTallyProps {
  claim: Claim
  currentLedger: number
  loading?: boolean
}

const STATUS_LABELS: Record<ClaimStatus, string> = {
  Processing: 'Voting in progress',
  Pending: 'Pending',
  Approved: 'Approved',
  Paid: 'Paid out',
  Rejected: 'Rejected',
  Withdrawn: 'Withdrawn by claimant',
}

const STATUS_VARIANT: Record<
  ClaimStatus,
  'default' | 'success' | 'destructive' | 'warning' | 'info' | 'secondary' | 'outline'
> = {
  Processing: 'info',
  Pending: 'warning',
  Approved: 'success',
  Paid: 'success',
  Rejected: 'destructive',
  Withdrawn: 'secondary',
}

function useCountdown(targetMs: number) {
  const [remaining, setRemaining] = useState(targetMs)

  useEffect(() => {
    if (targetMs <= 0) return
    const id = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [targetMs])

  const totalSec = Math.floor(remaining / 1000)
  const days = Math.floor(totalSec / 86400)
  const hours = Math.floor((totalSec % 86400) / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60

  return { days, hours, mins, secs, expired: remaining === 0 }
}

export function VoteTally({ claim, currentLedger, loading }: VoteTallyProps) {
  const total = claim.total_voters
  const approveCount = claim.approve_votes
  const rejectCount = claim.reject_votes
  const castCount = approveCount + rejectCount
  const approvePct = total > 0 ? Math.round((approveCount / total) * 100) : 0
  const rejectPct = total > 0 ? Math.round((rejectCount / total) * 100) : 0
  const quorumBps = claim.quorum_bps ?? DEFAULT_QUORUM_BPS
  const requiredCast = requiredBallotsForQuorum(total, quorumBps)

  const voteOpen = isVoteOpen(claim.voting_deadline_ledger, currentLedger)
  const terminal = isTerminal(claim.status)
  const msLeft = deadlineMs(claim.voting_deadline_ledger, currentLedger)
  const countdown = useCountdown(voteOpen && !terminal ? msLeft : 0)

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading vote tally">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    )
  }

  return (
    <section aria-label="Vote tally" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Current tally</h2>
        <Badge variant={STATUS_VARIANT[claim.status]}>
          {STATUS_LABELS[claim.status]}
        </Badge>
      </div>

      {/* Progress bar */}
      <div
        className="relative h-4 w-full overflow-hidden rounded-full bg-gray-200"
        role="img"
        aria-label={`${approvePct}% approve, ${rejectPct}% reject`}
      >
        <div
          className="absolute left-0 top-0 h-full bg-green-500 transition-all duration-500"
          style={{ width: `${approvePct}%` }}
        />
        <div
          className="absolute right-0 top-0 h-full bg-red-500 transition-all duration-500"
          style={{ width: `${rejectPct}%` }}
        />
      </div>

      <div className="flex justify-between text-sm">
        <span className="text-green-700 font-medium">
          ✓ Approve — {approveCount} ({approvePct}%)
        </span>
        <span className="text-red-700 font-medium">
          ✗ Reject — {rejectCount} ({rejectPct}%)
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {castCount} of {total} eligible voters have cast a ballot. Participation quorum: at least{' '}
        {requiredCast} cast vote{requiredCast === 1 ? '' : 's'} (ceil(eligible × {quorumBps} ÷
        10,000) bps). Once quorum is met, the side with more approve vs reject votes wins; ties reject.
      </p>

      {/* Deadline */}
      {!terminal && (
        <div
          className="rounded-md border px-3 py-2 text-xs"
          aria-live="polite"
          aria-atomic="true"
        >
          {voteOpen && !countdown.expired ? (
            <span>
              Voting closes in{' '}
              <strong>
                {countdown.days}d {countdown.hours}h {countdown.mins}m{' '}
                {countdown.secs}s
              </strong>
            </span>
          ) : (
            <span className="text-muted-foreground">
              Voting window has closed. Awaiting finalization.
            </span>
          )}
        </div>
      )}
    </section>
  )
}
