'use client'

import { useState, useCallback } from 'react'
import { AlertCircle, CheckCircle, ExternalLink, Lock, Unlock, Eye, EyeOff, Clock } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { explorerUrl } from '@/lib/api/vote'
import { useLatestLedger } from '@/hooks/use-latest-ledger'
import { DeadlineCountdown } from './DeadlineCountdown'

type Phase = 'commit' | 'reveal' | 'closed' | 'not_set'

interface CommitRevealPhases {
  commitPhaseEndLedger: number
  revealPhaseEndLedger: number
}

interface CommitRevealState {
  phase: Phase
  committed: boolean
  revealed: boolean
  commitTxHash?: string
  revealTxHash?: string
  commitPhaseEndLedger: number
  revealPhaseEndLedger: number
  voted: 'Approve' | 'Reject' | null
}

interface CommitRevealFlowProps {
  claimId: string
  commitReveal: CommitRevealState
  onCommit: (vote: 'Approve' | 'Reject') => Promise<void>
  onReveal: (vote: 'Approve' | 'Reject') => Promise<void>
}

function getCurrentPhase(phases: CommitRevealPhases, currentLedger: number): Phase {
  if (currentLedger <= phases.commitPhaseEndLedger) return 'commit'
  if (currentLedger <= phases.revealPhaseEndLedger) return 'reveal'
  return 'closed'
}

function PhaseBadge({ phase }: { phase: Phase }) {
  const map: Record<Phase, { label: string; variant: 'info' | 'success' | 'warning' | 'destructive' }> = {
    commit: { label: 'Commit Phase', variant: 'info' },
    reveal: { label: 'Reveal Phase', variant: 'success' },
    closed: { label: 'Voting Closed', variant: 'destructive' },
    not_set: { label: 'Not Configured', variant: 'warning' },
  }
  const { label, variant } = map[phase]
  return <Badge variant={variant}>{label}</Badge>
}

type StepStatus = 'pending' | 'active' | 'completed' | 'expired'

interface StepIndicatorProps {
  stepNumber: number
  label: string
  status: StepStatus
}

function StepIndicator({ stepNumber, label, status }: StepIndicatorProps) {
  const circleClass =
    status === 'completed'
      ? 'bg-green-600 text-white'
      : status === 'active'
        ? 'bg-blue-600 text-white animate-pulse'
        : status === 'expired'
          ? 'bg-gray-400 text-white'
          : 'bg-gray-200 text-gray-500'

  const labelClass =
    status === 'completed'
      ? 'text-green-700 font-medium'
      : status === 'active'
        ? 'text-blue-700 font-medium'
        : 'text-muted-foreground'

  return (
    <div className="flex items-center gap-2">
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${circleClass}`}>
        {status === 'completed' ? <CheckCircle className="h-4 w-4" /> : stepNumber}
      </div>
      <span className={`text-sm ${labelClass}`}>{label}</span>
    </div>
  )
}

function StatusTracker({
  phase,
  committed,
  revealed,
}: {
  phase: Phase
  committed: boolean
  revealed: boolean
}) {
  const commitStatus: StepStatus = committed
    ? 'completed'
    : phase === 'commit'
      ? 'active'
      : phase === 'reveal' || phase === 'closed'
        ? 'expired'
        : 'pending'

  const revealStatus: StepStatus = revealed
    ? 'completed'
    : committed && phase === 'reveal'
      ? 'active'
      : phase === 'closed'
        ? 'expired'
        : 'pending'

  const tallyStatus: StepStatus = revealed
    ? 'completed'
    : phase === 'closed' && !revealed
      ? 'expired'
      : 'pending'

  return (
    <div className="flex items-center gap-2" aria-label="Voting progress">
      <StepIndicator stepNumber={1} label="Commit" status={commitStatus} />
      <div className="h-px w-6 bg-gray-300" aria-hidden="true" />
      <StepIndicator stepNumber={2} label="Reveal" status={revealStatus} />
      <div className="h-px w-6 bg-gray-300" aria-hidden="true" />
      <StepIndicator stepNumber={3} label="Counted" status={tallyStatus} />
    </div>
  )
}

function SecretVoteSelector({
  selected,
  onSelect,
  disabled,
}: {
  selected: 'Approve' | 'Reject' | null
  onSelect: (vote: 'Approve' | 'Reject') => void
  disabled: boolean
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">Select your vote (hidden until reveal):</p>
      <div className="flex gap-3">
        <Button
          variant={selected === 'Approve' ? 'default' : 'outline'}
          className="flex-1"
          onClick={() => onSelect('Approve')}
          disabled={disabled}
        >
          <Lock className="mr-2 h-4 w-4" />
          Approve
        </Button>
        <Button
          variant={selected === 'Reject' ? 'destructive' : 'outline'}
          className="flex-1"
          onClick={() => onSelect('Reject')}
          disabled={disabled}
        >
          <Lock className="mr-2 h-4 w-4" />
          Reject
        </Button>
      </div>
    </div>
  )
}

export function CommitRevealFlow({ claimId: _claimId, commitReveal, onCommit, onReveal }: CommitRevealFlowProps) {
  const latestLedger = useLatestLedger()
  const currentLedger = latestLedger ?? 0

  const [selectedVote, setSelectedVote] = useState<'Approve' | 'Reject' | null>(null)
  const [committing, setCommitting] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)
  const [commitDone, setCommitDone] = useState(false)
  const [revealDone, setRevealDone] = useState(false)

  const phases: CommitRevealPhases = {
    commitPhaseEndLedger: commitReveal.commitPhaseEndLedger,
    revealPhaseEndLedger: commitReveal.revealPhaseEndLedger,
  }

  const phase = commitReveal.phase === 'not_set' ? 'not_set' : getCurrentPhase(phases, currentLedger)

  const isCommitted = commitDone || commitReveal.committed
  const isRevealed = revealDone || commitReveal.revealed

  const handleCommit = useCallback(async () => {
    if (!selectedVote) return
    setCommitting(true)
    setCommitError(null)
    try {
      await onCommit(selectedVote)
      setCommitDone(true)
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : 'Commit failed')
    } finally {
      setCommitting(false)
    }
  }, [selectedVote, onCommit])

  const handleReveal = useCallback(async () => {
    if (!selectedVote) return
    setRevealing(true)
    setRevealError(null)
    try {
      await onReveal(selectedVote)
      setRevealDone(true)
    } catch (e) {
      setRevealError(e instanceof Error ? e.message : 'Reveal failed')
    } finally {
      setRevealing(false)
    }
  }, [selectedVote, onReveal])

  if (commitReveal.phase === 'not_set') {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Commit-Reveal Voting</CardTitle>
            <PhaseBadge phase="not_set" />
          </div>
          <CardDescription>Commit-reveal voting has not been enabled for this claim.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Commit-Reveal Voting</CardTitle>
          <PhaseBadge phase={phase} />
        </div>
        <CardDescription>
          {phase === 'commit' && 'Submit a hidden commitment now, then reveal your vote in the reveal phase.'}
          {phase === 'reveal' && 'The commit phase has ended. Reveal your vote to have it counted.'}
          {phase === 'closed' && 'The voting window has closed.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <StatusTracker phase={phase} committed={isCommitted} revealed={isRevealed} />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border bg-muted p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Commit Deadline</p>
            <p className="mt-1 text-sm font-medium tabular-nums">Ledger {commitReveal.commitPhaseEndLedger}</p>
            {latestLedger !== null && phase === 'commit' && (
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <DeadlineCountdown deadlineLedger={commitReveal.commitPhaseEndLedger} currentLedger={latestLedger} />
              </div>
            )}
          </div>
          <div className="rounded-lg border bg-muted p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Reveal Deadline</p>
            <p className="mt-1 text-sm font-medium tabular-nums">Ledger {commitReveal.revealPhaseEndLedger}</p>
            {latestLedger !== null && (phase === 'commit' || phase === 'reveal') && (
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <DeadlineCountdown deadlineLedger={commitReveal.revealPhaseEndLedger} currentLedger={latestLedger} />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-lg border bg-blue-50 p-3 text-sm text-blue-800">
          {phase === 'commit' ? (
            <>
              <Lock className="h-5 w-5 shrink-0" />
              <span>Your vote is encrypted as a SHA-256 hash. No one can see it until you reveal it.</span>
            </>
          ) : phase === 'reveal' ? (
            <>
              <Unlock className="h-5 w-5 shrink-0" />
              <span>Reveal your vote to decrypt and record it on-chain. Unrevealed votes are not counted.</span>
            </>
          ) : (
            <>
              <EyeOff className="h-5 w-5 shrink-0" />
              <span>Voting has closed for this claim.</span>
            </>
          )}
        </div>

        {phase === 'commit' && !isCommitted && (
          <div className="space-y-4">
            <SecretVoteSelector selected={selectedVote} onSelect={setSelectedVote} disabled={committing} />
            <Button
              className="w-full"
              onClick={handleCommit}
              disabled={!selectedVote || committing}
            >
              {committing ? 'Submitting commitment...' : 'Submit Encrypted Commitment'}
            </Button>
            {commitError && (
              <div role="alert" className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {commitError}
              </div>
            )}
          </div>
        )}

        {isCommitted && (
          <div className="space-y-3">
            <div role="status" className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              <CheckCircle className="h-4 w-4 shrink-0" />
              <span>Commitment submitted successfully.</span>
              {commitReveal.commitTxHash && (
                <a href={explorerUrl(commitReveal.commitTxHash)} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 underline underline-offset-2">
                  View on Explorer <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            {phase === 'commit' && !isRevealed && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <Eye className="mr-1 inline h-4 w-4" />
                Waiting for reveal phase to begin. You will be able to reveal your vote once the commit phase ends.
              </div>
            )}

            {phase === 'reveal' && !isRevealed && (
              <div className="space-y-4 border-t pt-4">
                <p className="text-sm font-medium">Step 2: Reveal your vote</p>
                <SecretVoteSelector selected={selectedVote} onSelect={setSelectedVote} disabled={revealing} />
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={handleReveal}
                  disabled={!selectedVote || revealing}
                >
                  {revealing ? 'Revealing vote...' : 'Reveal & Record Vote'}
                </Button>
                {revealError && (
                  <div role="alert" className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {revealError}
                  </div>
                )}
              </div>
            )}

            {isRevealed && (
              <div role="status" className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                <CheckCircle className="h-4 w-4 shrink-0" />
                <span>Vote revealed and recorded as <strong>{commitReveal.voted ?? selectedVote}</strong>.</span>
                {commitReveal.revealTxHash && (
                  <a href={explorerUrl(commitReveal.revealTxHash)} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 underline underline-offset-2">
                    View on Explorer <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}

            {phase === 'closed' && !isRevealed && isCommitted && (
              <div role="alert" className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>The reveal window has closed. Your commitment was not revealed and will not be counted.</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
