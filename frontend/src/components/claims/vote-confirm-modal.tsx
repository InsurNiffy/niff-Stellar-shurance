'use client'

import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { VoteOption, Claim } from '@/lib/schemas/vote'
import { cn } from '@/lib/utils'

interface VoteConfirmModalProps {
  open: boolean
  vote: VoteOption | null
  claimId: string
  /** Current tally snapshot — shown in the modal for context. */
  claim?: Pick<Claim, 'approve_votes' | 'reject_votes' | 'total_voters'> | null
  submitting: boolean
  onConfirm: () => void
  onCancel: () => void
}

const COPY: Record<
  VoteOption,
  { title: string; description: string; confirmLabel: string; icon: React.ReactNode }
> = {
  Approve: {
    title: 'Confirm approval vote',
    description:
      'Voting to approve indicates that, based on the evidence provided, this claim appears valid under the policy terms. If a quorum of eligible policyholders approves, the claimant becomes eligible for payout. Your vote alone does not determine the outcome.',
    confirmLabel: 'Sign & approve',
    icon: <CheckCircle className="h-5 w-5 text-green-600" aria-hidden="true" />,
  },
  Reject: {
    title: 'Confirm rejection vote',
    description:
      'Voting to reject indicates that this claim does not appear to meet the policy conditions. If a quorum of eligible policyholders rejects, no payout will be issued. Your vote alone does not determine the outcome.',
    confirmLabel: 'Sign & reject',
    icon: <XCircle className="h-5 w-5 text-red-600" aria-hidden="true" />,
  },
}

/** One-sentence governance explainer (reviewed by product/legal). */
const GOVERNANCE_EXPLAINER =
  'Claim outcomes are decided collectively by eligible policyholders — no single vote determines the result.'

export function VoteConfirmModal({
  open,
  vote,
  claimId,
  claim,
  submitting,
  onConfirm,
  onCancel,
}: VoteConfirmModalProps) {
  if (!vote) return null
  const copy = COPY[vote]

  const approveCount = claim?.approve_votes ?? 0
  const rejectCount = claim?.reject_votes ?? 0
  const totalVoters = claim?.total_voters ?? 0
  const castCount = approveCount + rejectCount

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onCancel()}>
      <DialogContent
        aria-modal="true"
        aria-labelledby="vote-confirm-title"
        aria-describedby="vote-confirm-desc"
        onEscapeKeyDown={(e) => {
          // Prevent ESC during submission to avoid accidental cancellation
          if (submitting) {
            e.preventDefault()
          } else {
            onCancel()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle id="vote-confirm-title" className="flex items-center gap-2">
            {copy.icon}
            {copy.title}
          </DialogTitle>
          <DialogDescription id="vote-confirm-desc">
            {copy.description}
          </DialogDescription>
        </DialogHeader>

        {/* Prominent vote option display */}
        <div
          className={cn(
            'rounded-lg border-2 px-4 py-3 text-center font-semibold',
            vote === 'Approve'
              ? 'border-green-500 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100'
              : 'border-red-500 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100'
          )}
          role="status"
          aria-label={`You are voting to ${vote.toLowerCase()} this claim`}
        >
          <div className="flex items-center justify-center gap-2">
            {copy.icon}
            <span className="text-lg">
              You are voting to <strong className="uppercase">{vote}</strong>
            </span>
          </div>
        </div>

        {/* Governance explainer */}
        <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
          {GOVERNANCE_EXPLAINER}
        </p>

        {/* Current tally */}
        {claim && (
          <div
            aria-label="Current vote tally"
            className="rounded-md border bg-muted/40 px-3 py-2 text-xs space-y-1"
          >
            <p className="font-medium text-foreground">Current tally</p>
            <div className="flex justify-between text-muted-foreground">
              <span className="text-green-700 dark:text-green-400">Approve: {approveCount}</span>
              <span className="text-red-700 dark:text-red-400">Reject: {rejectCount}</span>
              <span>{castCount} of {totalVoters} voted</span>
            </div>
          </div>
        )}

        {/* Claim ID + transaction info */}
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
          <p>
            Claim ID: <span className="font-mono">{claimId}</span>
          </p>
          <p>Your wallet will be prompted to sign the transaction. Network fees apply.</p>
        </div>

        {/* Irreversibility warning */}
        <div
          role="note"
          className="flex items-start gap-2 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-900 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-100"
        >
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span>
            <strong>This action is irreversible.</strong> Once submitted on-chain, your vote cannot
            be changed or retracted. If you&apos;re using a wallet&apos;s built-in browser,
            extension-based signing may not be available — use the wallet&apos;s native signing
            prompt instead.
          </span>
        </div>

        <DialogFooter>
          <Button
            className="w-full sm:w-auto"
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
            aria-label="Cancel and dismiss without voting"
          >
            Cancel
          </Button>
          <Button
            className="w-full sm:w-auto"
            variant={vote === 'Reject' ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={submitting}
            aria-label={copy.confirmLabel}
            aria-busy={submitting}
          >
            {submitting ? 'Signing…' : copy.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
