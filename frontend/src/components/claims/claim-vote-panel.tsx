'use client'

import { CheckCircle, XCircle, ExternalLink, AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useWallet } from '@/features/wallet'
import { useLatestLedger } from '@/hooks/use-latest-ledger'
import {
  fetchClaim,
  fetchEligibility,
  simulateVote,
  submitVote,
  explorerUrl,
  getVoteErrorMessage,
  VoteAPIError,
} from '@/lib/api/vote'
import {
  Claim,
  Eligibility,
  VoteOption,
  isTerminal,
  isVoteOpen,
} from '@/lib/schemas/vote'
import { trackVoteCast } from '@/lib/analytics'

import { VoteConfirmModal } from './vote-confirm-modal'
import { VoteEducationPanel } from './vote-education-panel'
import { VoteTally } from './vote-tally'

interface ClaimVotePanelProps {
  claimId: string
}

type SubmitState = 'idle' | 'simulating' | 'confirming' | 'signing' | 'submitting' | 'done'

const POLL_INTERVAL_MS = 8_000

export function ClaimVotePanel({ claimId }: ClaimVotePanelProps) {
  const { address: walletAddress, signTransaction } = useWallet()
  const latestLedger = useLatestLedger()
  const currentLedger = latestLedger ?? 0
  const { toast } = useToast()

  const [claim, setClaim] = useState<Claim | null>(null)
  const [eligibility, setEligibility] = useState<Eligibility | null>(null)
  const [loadingClaim, setLoadingClaim] = useState(true)
  const [loadingEligibility, setLoadingEligibility] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)

  const [pendingVote, setPendingVote] = useState<VoteOption | null>(null)
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [simError, setSimError] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Load claim ──────────────────────────────────────────────────────────────
  const loadClaim = useCallback(async () => {
    try {
      const c = await fetchClaim(claimId)
      setClaim(c)
      setClaimError(null)
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : 'Failed to load claim')
    }
  }, [claimId])

  useEffect(() => {
    setLoadingClaim(true)
    loadClaim().finally(() => setLoadingClaim(false))
  }, [loadClaim])

  // ── Poll tally while vote is open ───────────────────────────────────────────
  useEffect(() => {
    if (!claim) return
    if (isTerminal(claim.status) || !isVoteOpen(claim.voting_deadline_ledger, currentLedger)) return

    pollRef.current = setInterval(loadClaim, POLL_INTERVAL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [claim, currentLedger, loadClaim])

  // ── Load eligibility when wallet connects ───────────────────────────────────
  useEffect(() => {
    if (!walletAddress || !claimId) return
    setLoadingEligibility(true)
    fetchEligibility(claimId, walletAddress)
      .then(setEligibility)
      .catch(() => setEligibility(null))
      .finally(() => setLoadingEligibility(false))
  }, [claimId, walletAddress])

  // ── Vote flow ───────────────────────────────────────────────────────────────
  const handleVoteClick = useCallback(
    async (vote: VoteOption) => {
      if (!walletAddress) return
      setSimError(null)
      setSubmitState('simulating')

      const simErr = await simulateVote(claimId, walletAddress, vote)
      if (simErr) {
        setSimError(simErr)
        setSubmitState('idle')
        return
      }

      setPendingVote(vote)
      setSubmitState('confirming')
    },
    [claimId, walletAddress],
  )

  const handleConfirm = useCallback(async () => {
    if (!pendingVote || !walletAddress) return
    setSubmitState('signing')

    try {
      // In production, requestSignature opens the wallet popup with the XDR.
      // Here we pass a placeholder XDR; the backend builds the real transaction.
      const signedXdr = await signTransaction(`vote:${claimId}:${pendingVote}`)

      setSubmitState('submitting')
      const result = await submitVote(claimId, walletAddress, pendingVote, signedXdr)

      setTxHash(result.transactionHash)
      setClaim((prev) =>
        prev
          ? {
              ...prev,
              status: result.status,
              approve_votes: result.approve_votes,
              reject_votes: result.reject_votes,
            }
          : prev,
      )
      setEligibility((prev) => (prev ? { ...prev, priorVote: pendingVote } : prev))
      setSubmitState('done')
      trackVoteCast(pendingVote === 'Approve' ? 'approve' : 'reject')

      toast({
        title: 'Vote submitted',
        description: `Your ${pendingVote.toLowerCase()} vote was recorded on-chain.`,
      })
    } catch (e) {
      const msg =
        e instanceof VoteAPIError
          ? getVoteErrorMessage(e)
          : e instanceof Error
            ? e.message
            : 'Vote submission failed'
      toast({ title: 'Vote failed', description: msg, variant: 'destructive' })
      setSubmitState('idle')
    } finally {
      setPendingVote(null)
    }
  }, [claimId, pendingVote, requestSignature, toast, walletAddress])

  const handleCancel = useCallback(() => {
    setPendingVote(null)
    setSubmitState('idle')
  }, [])

  // ── Derived state ───────────────────────────────────────────────────────────
  const voteOpen = claim ? isVoteOpen(claim.voting_deadline_ledger, currentLedger) : false
  const terminal = claim ? isTerminal(claim.status) : false
  const alreadyVoted = eligibility?.priorVote != null
  const eligible = eligibility?.eligible === true
  const ineligibleReason = eligibility?.reason

  const canVote =
    !!walletAddress &&
    eligible &&
    !alreadyVoted &&
    voteOpen &&
    !terminal &&
    submitState === 'idle'

  const disabledTooltip = !walletAddress
    ? 'Connect your wallet to vote'
    : !eligible
      ? (ineligibleReason ?? 'Your wallet is not eligible to vote on this claim')
      : alreadyVoted
        ? `You already voted ${eligibility.priorVote?.toLowerCase()} on this claim`
        : !voteOpen
          ? 'The voting window for this claim has closed'
          : terminal
            ? 'This claim has already been resolved'
            : undefined

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loadingClaim) {
    return (
      <div className="space-y-4 p-4" aria-busy="true" aria-label="Loading claim">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (claimError || !claim) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
      >
        <AlertTriangle className="mb-1 inline h-4 w-4" aria-hidden="true" />{' '}
        {claimError ?? 'Claim not found.'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Governance education — always visible, not confused with premium flows */}
      <VoteEducationPanel />

      {/* Live tally */}
      <VoteTally claim={claim} currentLedger={currentLedger} />

      {/* Prior vote badge */}
      {alreadyVoted && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 text-sm"
        >
          {eligibility.priorVote === 'Approve' ? (
            <CheckCircle className="h-4 w-4 text-green-600" aria-hidden="true" />
          ) : (
            <XCircle className="h-4 w-4 text-red-600" aria-hidden="true" />
          )}
          <span>
            You voted{' '}
            <Badge
              variant={eligibility.priorVote === 'Approve' ? 'success' : 'destructive'}
              className="text-xs"
            >
              {eligibility.priorVote}
            </Badge>{' '}
            on this claim.
          </span>
        </div>
      )}

      {/* Simulation error */}
      {simError && (
        <div
          role="alert"
          className="rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-900"
        >
          <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
          Pre-flight check failed: {simError}
        </div>
      )}

      {/* Post-vote tx link */}
      {submitState === 'done' && txHash && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Vote confirmed on-chain.</span>
          <a
            href={explorerUrl(txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 underline underline-offset-2"
            aria-label="View transaction on Stellar Explorer (opens in new tab)"
          >
            View on Explorer
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      )}

      {/* Vote actions — sticky bar at bottom on mobile, inline on larger screens */}
      {!terminal && (
        <div
          className="sticky-action-bar bg-background/95 backdrop-blur-sm border-t pt-3 -mx-4 px-4 sm:static sm:border-0 sm:bg-transparent sm:backdrop-blur-none sm:pt-0 sm:mx-0 sm:px-0"
          role="group"
          aria-label="Cast your vote"
        >
          <div className="flex gap-3">
            {/* Approve */}
            <div className="relative flex-1" title={!canVote ? disabledTooltip : undefined}>
              <Button
                className="w-full"
                variant="default"
                disabled={!canVote || submitState !== 'idle'}
                aria-disabled={!canVote}
                aria-label="Vote to approve this claim"
                aria-describedby={!canVote ? 'vote-ineligible-msg' : undefined}
                onClick={() => handleVoteClick('Approve')}
              >
                <CheckCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                Approve
              </Button>
            </div>

            {/* Reject */}
            <div className="relative flex-1" title={!canVote ? disabledTooltip : undefined}>
              <Button
                className="w-full"
                variant="destructive"
                disabled={!canVote || submitState !== 'idle'}
                aria-disabled={!canVote}
                aria-label="Vote to reject this claim"
                aria-describedby={!canVote ? 'vote-ineligible-msg' : undefined}
                onClick={() => handleVoteClick('Reject')}
              >
                <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                Reject
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Eligibility explanation for screen readers and visible hint */}
      {!canVote && !terminal && disabledTooltip && (
        <p
          id="vote-ineligible-msg"
          role="note"
          className="text-xs text-muted-foreground"
        >
          {disabledTooltip}
        </p>
      )}

      {/* Eligibility loading */}
      {loadingEligibility && (
        <p className="text-xs text-muted-foreground" aria-busy="true">
          Checking eligibility…
        </p>
      )}

      {/* Confirmation modal */}
      <VoteConfirmModal
        open={submitState === 'confirming'}
        vote={pendingVote}
        claimId={claimId}
        claim={claim}
        submitting={submitState === 'signing' || submitState === 'submitting'}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </div>
  )
}
