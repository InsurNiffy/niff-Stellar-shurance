'use client';

import { AlertCircle, Info, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Claim } from '@/lib/schemas/vote';

/**
 * The reason this wallet cannot appeal, or null when appeal is allowed.
 * Maps 1-to-1 with APPEAL_ERROR_MESSAGES codes from vote.ts so the panel can
 * derive this from a VoteAPIError.code or from local eligibility logic.
 */
export type AppealIneligibilityReason =
  | 'NOT_CLAIMANT'
  | 'CLAIM_NOT_REJECTED'
  | 'APPEAL_ALREADY_SUBMITTED'
  | 'APPEAL_WINDOW_CLOSED'
  | null;

/** Human-readable explanation shown to the user for each ineligibility reason. */
const INELIGIBILITY_MESSAGES: Record<NonNullable<AppealIneligibilityReason>, string> = {
  NOT_CLAIMANT:
    'Only the original claimant can appeal this decision. Connect the wallet that submitted this claim.',
  CLAIM_NOT_REJECTED:
    'Appeals are only available for rejected claims. This claim has not been rejected.',
  APPEAL_ALREADY_SUBMITTED:
    'An appeal has already been submitted for this claim. Only one appeal is permitted per claim.',
  APPEAL_WINDOW_CLOSED:
    'The appeal window for this claim has closed. No further appeals can be submitted.',
};

export interface AppealButtonProps {
  /** The claim to appeal */
  claim: Claim;
  /** Connected wallet address */
  walletAddress: string | null;
  /** Whether the appeal status check is still in-flight */
  loadingAppealStatus?: boolean;
  /**
   * Explicit ineligibility reason derived by the parent.
   * When provided, shows an explanatory message instead of hiding the button.
   * When null and all local checks pass, the action button is shown.
   */
  ineligibilityReason?: AppealIneligibilityReason;
  /** Whether an appeal is currently being submitted */
  submitting?: boolean;
  /** Click handler to open the appeal confirmation modal */
  onClick: (e?: React.MouseEvent<HTMLElement>) => void;
  /** Optional CSS class */
  className?: string;
}

/**
 * AppealButton — shows an appeal button for rejected claims, or an explanatory
 * message when the user is not eligible to appeal.
 *
 * Replaces the old "return null" approach for ineligible states with clear,
 * specific guidance so users understand exactly why they cannot appeal.
 *
 * Visible states:
 *  - Loading skeleton while appeal status resolves (#1337)
 *  - Enabled button when wallet is claimant and appeal is available
 *  - Informational message for each specific ineligibility reason (#1336)
 */
export function AppealButton({
  claim,
  walletAddress,
  loadingAppealStatus = false,
  ineligibilityReason = null,
  submitting = false,
  onClick,
  className,
}: AppealButtonProps) {
  // ── Loading state: show skeleton while checkAppealStatus resolves ──────────
  if (loadingAppealStatus) {
    return (
      <div className={className} aria-busy="true" aria-label="Checking appeal eligibility">
        <Skeleton className="h-9 w-48" />
        <span className="sr-only">Checking appeal eligibility…</span>
      </div>
    );
  }

  // ── Derive local ineligibility when parent hasn't supplied an explicit reason
  const localReason: AppealIneligibilityReason = (() => {
    if (ineligibilityReason) return ineligibilityReason;
    if (claim.status !== 'Rejected') return 'CLAIM_NOT_REJECTED';
    if (!walletAddress || walletAddress !== claim.claimant) return 'NOT_CLAIMANT';
    return null;
  })();

  // ── Ineligible: show explanatory message instead of hiding (#1336) ─────────
  if (localReason) {
    return (
      <div
        className={className}
        role="note"
        aria-label={`Appeal unavailable: ${INELIGIBILITY_MESSAGES[localReason]}`}
      >
        <div className="flex items-start gap-2 rounded-lg border border-muted bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{INELIGIBILITY_MESSAGES[localReason]}</span>
        </div>
      </div>
    );
  }

  // ── Eligible: show the action button ─────────────────────────────────────
  return (
    <div className={className}>
      <Button
        variant="outline"
        onClick={(e) => onClick(e)}
        disabled={submitting}
        aria-label="Appeal this rejected claim"
        aria-busy={submitting}
        className="w-full sm:w-auto"
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Submitting Appeal…
          </>
        ) : (
          <>
            <AlertCircle className="mr-2 h-4 w-4" aria-hidden="true" />
            Appeal Decision
          </>
        )}
      </Button>
    </div>
  );
}
