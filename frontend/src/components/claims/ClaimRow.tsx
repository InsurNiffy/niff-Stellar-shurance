"use client";

// Feature: claims-board

import type { ClaimBoard } from "@/lib/schemas/claims-board";

import { DeadlineDisplay } from "./DeadlineDisplay";
import { QuorumIndicator } from "./QuorumIndicator";

// Requirements: 1.5, 8.1, 8.2, 8.3, 9.1, 9.3

const INDEXER_LAG_SECONDS = 30;

export interface ClaimRowProps {
  claim: ClaimBoard;
  isAuthenticated: boolean;
  onVote?: (claimId: string, vote: "approve" | "reject" | "abstain") => void;
  currentLedger?: number | null;
}

/** Maps ClaimStatus to a human-readable label and a shape indicator (non-color-only, Req 9.3) */
// AA-compliant contrast ratios (≥4.5:1 on white/light backgrounds).
// Verified: yellow-900 on yellow-100 ≈ 7.5:1; gray-800 on gray-100 ≈ 7:1;
// green-900 on green-100 ≈ 7:1; blue-900 on blue-100 ≈ 7:1;
// red-900 on red-100 ≈ 7:1; slate-800 on slate-100 ≈ 6.5:1.
const STATUS_CONFIG: Record<
  string,
  { label: string; shape: string; className: string }
> = {
  Processing: {
    label: "Processing",
    shape: "◐",
    className: "bg-yellow-100 text-yellow-900",
  },
  Pending: {
    label: "Pending",
    shape: "○",
    className: "bg-gray-100 text-gray-800",
  },
  Approved: {
    label: "Approved",
    shape: "●",
    className: "bg-green-100 text-green-900",
  },
  Paid: {
    label: "Paid",
    shape: "★",
    className: "bg-blue-100 text-blue-900",
  },
  Rejected: {
    label: "Rejected",
    shape: "✕",
    className: "bg-red-100 text-red-900",
  },
  Withdrawn: {
    label: "Withdrawn",
    shape: "↩",
    className: "bg-slate-100 text-slate-800",
  },
};

const DEFAULT_STATUS_CONFIG = {
  label: "Unknown",
  shape: "?",
  className: "bg-gray-100 text-gray-800",
};

/** Determine if a claim is "open" for voting purposes */
function isClaimOpen(claim: ClaimBoard): boolean {
  return claim.status === "Processing" || claim.status === "Pending";
}

/**
 * ClaimRow renders a single claim entry.
 *
 * Layout:
 * - Mobile (≤320px / below sm breakpoint): card (flex-col)
 * - Desktop (sm+): table-row equivalent (flex-row)
 *
 * Accessibility:
 * - All interactive controls have ARIA labels (Req 9.3)
 * - Minimum 44×44 CSS px touch targets (Req 8.3)
 * - Keyboard-reachable via Tab (Req 9.1)
 */
export function ClaimRow({
  claim,
  isAuthenticated,
  onVote,
  currentLedger = null,
}: ClaimRowProps) {
  const statusCfg = STATUS_CONFIG[claim.status] ?? DEFAULT_STATUS_CONFIG;
  const claimOpen = isClaimOpen(claim);
  const showVoteActions = isAuthenticated && claimOpen;

  const totalCast = claim.approve_votes + claim.reject_votes;
  const quorumThreshold = claim.quorum_threshold ?? claim.total_voters;

  return (
    <article
      aria-label={`Claim ${claim.claim_id}`}
      className={[
        // Base: card on mobile (flex-col), row on desktop (flex-row)
        "flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4",
        "sm:flex-row sm:items-start sm:gap-6 sm:rounded-none sm:border-x-0 sm:border-t-0 sm:border-b sm:px-4 sm:py-3",
      ].join(" ")}
    >
      {/* ── Claim identity ─────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Claim ID */}
          <span className="font-mono text-sm font-semibold text-gray-900 truncate">
            {claim.claim_id}
          </span>

          {/* Status badge — shape + text label (non-color-only, Req 9.3) */}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusCfg.className}`}
            aria-label={`Status: ${statusCfg.label}`}
          >
            <span aria-hidden="true">{statusCfg.shape}</span>
            {statusCfg.label}
          </span>
        </div>

        {/* Policy reference */}
        <p className="text-xs text-gray-500">
          Policy:{" "}
          <span className="font-medium text-gray-700">{claim.policy_id}</span>
        </p>

        {/* Tally summary */}
        <p
          className="text-xs text-gray-500"
          aria-live="polite"
          aria-atomic="true"
        >
          Votes — Approve:{" "}
          <span className="font-medium text-gray-700">
            {claim.approve_votes}
          </span>
          {" · "}Reject:{" "}
          <span className="font-medium text-gray-700">
            {claim.reject_votes}
          </span>
          {" · "}Total cast:{" "}
          <span className="font-medium text-gray-700">{totalCast}</span>
        </p>
      </div>

      {/* ── Quorum indicator ───────────────────────────────────────── */}
      <div className="sm:w-48 shrink-0">
        <QuorumIndicator
          approveVotes={claim.approve_votes}
          rejectVotes={claim.reject_votes}
          quorumThreshold={quorumThreshold}
        />
      </div>

      {/* ── Deadline display ───────────────────────────────────────── */}
      <div className="sm:w-44 shrink-0">
        <DeadlineDisplay
          votingDeadlineLedger={claim.voting_deadline_ledger}
          currentLedger={currentLedger}
          deadlineTimestamp={claim.deadline_timestamp}
          indexerLagSeconds={INDEXER_LAG_SECONDS}
        />
      </div>

      {/* ── Vote action buttons ────────────────────────────────────── */}
      {showVoteActions && onVote && (
        <div
          className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:gap-1"
          role="group"
          aria-label={`Vote actions for claim ${claim.claim_id}`}
        >
          <button
            type="button"
            onClick={() => onVote(claim.claim_id, "approve")}
            aria-label={`Approve claim ${claim.claim_id}`}
            className="min-h-[44px] min-w-[44px] rounded border border-green-600 px-3 py-2 text-xs font-medium text-green-700 bg-white hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            ✓ Approve
          </button>
          <button
            type="button"
            onClick={() => onVote(claim.claim_id, "reject")}
            aria-label={`Reject claim ${claim.claim_id}`}
            className="min-h-[44px] min-w-[44px] rounded border border-red-600 px-3 py-2 text-xs font-medium text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            ✕ Reject
          </button>
          <button
            type="button"
            onClick={() => onVote(claim.claim_id, "abstain")}
            aria-label={`Abstain from voting on claim ${claim.claim_id}`}
            className="min-h-[44px] min-w-[44px] rounded border border-gray-400 px-3 py-2 text-xs font-medium text-gray-600 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            — Abstain
          </button>
        </div>
      )}
    </article>
  );
}
