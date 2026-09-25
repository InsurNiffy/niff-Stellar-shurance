'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Claim } from '../../../types/claim';

export type VoteEligibility =
  | { eligible: true }
  | {
      eligible: false;
      reason: 'not-in-snapshot' | 'own-claim' | 'already-voted' | 'deadline-passed';
    };

export interface ClaimVotePanelProps {
  claim: Claim;
  /** Whether the connected wallet is part of the voter snapshot. */
  inSnapshot: boolean;
  /** Whether the connected wallet authored the claim. */
  isOwnClaim: boolean;
  /** Whether the connected wallet has already cast a vote. */
  hasVoted: boolean;
  /** Unix seconds deadline for voting. */
  deadline: number;
  /** Current server tally. */
  tally: { approve: number; reject: number };
  /** Quorum required for the vote to count. */
  quorum: number;
  /** Submits a vote and resolves with the reconciled tally. */
  onVote: (choice: 'approve' | 'reject') => Promise<{ approve: number; reject: number }>;
}

const INELIGIBLE_COPY: Record<
  Exclude<VoteEligibility, { eligible: true }>['reason'],
  string
> = {
  'not-in-snapshot': 'Your wallet is not in the voter snapshot for this claim.',
  'own-claim': 'You cannot vote on a claim you filed.',
  'already-voted': 'You have already voted on this claim.',
  'deadline-passed': 'The voting deadline for this claim has passed.',
};

export function getVoteEligibility({
  inSnapshot,
  isOwnClaim,
  hasVoted,
  deadline,
  now = Date.now(),
}: {
  inSnapshot: boolean;
  isOwnClaim: boolean;
  hasVoted: boolean;
  deadline: number;
  now?: number;
}): VoteEligibility {
  if (isOwnClaim) return { eligible: false, reason: 'own-claim' };
  if (!inSnapshot) return { eligible: false, reason: 'not-in-snapshot' };
  if (hasVoted) return { eligible: false, reason: 'already-voted' };
  if (deadline * 1000 <= now) return { eligible: false, reason: 'deadline-passed' };
  return { eligible: true };
}

function formatCountdown(deadline: number, now: number): string {
  const remaining = Math.max(0, deadline * 1000 - now);
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

export default function ClaimVotePanel({
  claim,
  inSnapshot,
  isOwnClaim,
  hasVoted,
  deadline,
  tally,
  quorum,
  onVote,
}: ClaimVotePanelProps) {
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);
  const [confirming, setConfirming] = useState<'approve' | 'reject' | null>(null);
  const [optimistic, setOptimistic] = useState<{ approve: number; reject: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const eligibility = useMemo(
    () => getVoteEligibility({ inSnapshot, isOwnClaim, hasVoted, deadline, now }),
    [inSnapshot, isOwnClaim, hasVoted, deadline, now],
  );

  const displayed = optimistic ?? tally;
  const totalVotes = displayed.approve + displayed.reject;
  const quorumProgress = quorum > 0 ? Math.min(100, Math.round((totalVotes / quorum) * 100)) : 100;

  const submit = useCallback(
    async (choice: 'approve' | 'reject') => {
      if (inFlight.current) return;
      inFlight.current = true;
      setPending(choice);
      setError(null);
      setOptimistic({
        approve: tally.approve + (choice === 'approve' ? 1 : 0),
        reject: tally.reject + (choice === 'reject' ? 1 : 0),
      });
      try {
        const reconciled = await onVote(choice);
        setOptimistic(reconciled);
      } catch (err) {
        setOptimistic(null);
        setError(err instanceof Error ? err.message : 'Failed to submit vote.');
      } finally {
        inFlight.current = false;
        setPending(null);
        setConfirming(null);
      }
    },
    [onVote, tally.approve, tally.reject],
  );

  const disabled = !eligibility.eligible || pending !== null;

  return (
    <section className="claim-vote-panel" aria-label="Claim voting panel">
      <header className="claim-vote-panel__header">
        <h2>Vote on this claim</h2>
        <span className="claim-vote-panel__deadline" data-testid="vote-deadline">
          {eligibility.eligible || eligibility.reason !== 'deadline-passed'
            ? `Closes in ${formatCountdown(deadline, now)}`
            : 'Voting closed'}
        </span>
      </header>

      <dl className="claim-vote-panel__tally" data-testid="vote-tally">
        <div>
          <dt>Approve</dt>
          <dd data-testid="tally-approve">{displayed.approve}</dd>
        </div>
        <div>
          <dt>Reject</dt>
          <dd data-testid="tally-reject">{displayed.reject}</dd>
        </div>
      </dl>

      <div
        className="claim-vote-panel__quorum"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={quorumProgress}
        data-testid="quorum-progress"
      >
        <div className="claim-vote-panel__quorum-bar" style={{ width: `${quorumProgress}%` }} />
        <span>
          {totalVotes} / {quorum} votes for quorum
        </span>
      </div>

      {!eligibility.eligible && (
        <p className="claim-vote-panel__ineligible" role="status" data-testid="vote-ineligible">
          {INELIGIBLE_COPY[eligibility.reason]}
        </p>
      )}

      {error && (
        <p className="claim-vote-panel__error" role="alert">
          {error}
        </p>
      )}

      <div className="claim-vote-panel__actions">
        <button
          type="button"
          onClick={() => setConfirming('approve')}
          disabled={disabled}
          aria-busy={pending === 'approve'}
        >
          {pending === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming('reject')}
          disabled={disabled}
          aria-busy={pending === 'reject'}
        >
          {pending === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>

      {confirming && (
        <div
          className="claim-vote-panel__confirm"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm your vote"
        >
          <h3>Confirm your vote</h3>
          <p>
            You are about to <strong>{confirming}</strong> the claim “{claim.title}”.
          </p>
          <p className="claim-vote-panel__confirm-summary">{claim.summary}</p>
          <div className="claim-vote-panel__confirm-actions">
            <button
              type="button"
              onClick={() => submit(confirming)}
              disabled={pending !== null}
            >
              Confirm {confirming}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              disabled={pending !== null}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
