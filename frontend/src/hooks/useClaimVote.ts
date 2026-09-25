import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type VoteChoice = 'approve' | 'reject';

export type VoteIneligibilityReason =
  | 'not-in-snapshot'
  | 'own-claim'
  | 'already-voted'
  | 'deadline-passed';

export interface ClaimVoteTally {
  approvals: number;
  rejections: number;
  quorum: number;
}

export interface ClaimVoteState {
  /** Whether the connected user is allowed to cast a vote. */
  eligible: boolean;
  /** Machine-readable reason the user cannot vote, if any. */
  reason: VoteIneligibilityReason | null;
  /** Human-readable explanation surfaced in the panel. */
  reasonLabel: string | null;
  /** The choice the user already cast, if any. */
  existingVote: VoteChoice | null;
  /** Current tally, optimistically updated after a successful vote. */
  tally: ClaimVoteTally;
  /** Unix ms timestamp of the voting deadline. */
  deadline: number;
  /** Milliseconds remaining until the deadline (0 once passed). */
  timeRemaining: number;
  /** True while a vote request is in flight. */
  submitting: boolean;
  /** True once the user has voted in this session. */
  hasVoted: boolean;
  /** Cast a vote; resolves to the reconciled tally on success. */
  vote: (choice: VoteChoice) => Promise<ClaimVoteTally>;
}

export interface UseClaimVoteOptions {
  claimId: string;
  /** Address of the connected voter. */
  voter: string | null;
  /** Address that filed the claim. */
  claimAuthor: string;
  /** Addresses captured in the eligibility snapshot. */
  snapshot: string[];
  /** Unix ms timestamp of the voting deadline. */
  deadline: number;
  /** Initial tally loaded with the claim. */
  initialTally: ClaimVoteTally;
  /** The voter's existing vote, if the server already recorded one. */
  initialVote?: VoteChoice | null;
  /** Persists a vote and returns the authoritative tally. */
  submitVote: (input: {
    claimId: string;
    voter: string;
    choice: VoteChoice;
  }) => Promise<ClaimVoteTally>;
  /** Optional clock override for tests. */
  now?: () => number;
}

const REASON_LABELS: Record<VoteIneligibilityReason, string> = {
  'not-in-snapshot': 'You are not in the voter snapshot for this claim.',
  'own-claim': 'You cannot vote on a claim you filed.',
  'already-voted': 'You have already voted on this claim.',
  'deadline-passed': 'The voting deadline has passed.',
};

function normalize(address: string | null | undefined): string {
  return (address ?? '').trim().toLowerCase();
}

function applyVote(tally: ClaimVoteTally, choice: VoteChoice): ClaimVoteTally {
  return choice === 'approve'
    ? { ...tally, approvals: tally.approvals + 1 }
    : { ...tally, rejections: tally.rejections + 1 };
}

/**
 * Encapsulates claim voting eligibility, tally state, and submission for the
 * claim detail voting panel. Handles optimistic updates with server
 * reconciliation and guards against double submission.
 */
export function useClaimVote({
  claimId,
  voter,
  claimAuthor,
  snapshot,
  deadline,
  initialTally,
  initialVote = null,
  submitVote,
  now,
}: UseClaimVoteOptions): ClaimVoteState {
  const clock = now ?? Date.now;
  const [tally, setTally] = useState<ClaimVoteTally>(initialTally);
  const [existingVote, setExistingVote] = useState<VoteChoice | null>(initialVote);
  const [submitting, setSubmitting] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(() =>
    Math.max(0, deadline - clock()),
  );
  const inFlight = useRef(false);

  useEffect(() => {
    setTally(initialTally);
  }, [initialTally]);

  useEffect(() => {
    setExistingVote(initialVote);
  }, [initialVote]);

  useEffect(() => {
    const tick = () => setTimeRemaining(Math.max(0, deadline - clock()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline, clock]);

  const reason = useMemo<VoteIneligibilityReason | null>(() => {
    if (timeRemaining <= 0) return 'deadline-passed';
    if (!voter) return 'not-in-snapshot';
    if (normalize(voter) === normalize(claimAuthor)) return 'own-claim';
    if (existingVote) return 'already-voted';
    const eligible = snapshot.some((addr) => normalize(addr) === normalize(voter));
    if (!eligible) return 'not-in-snapshot';
    return null;
  }, [timeRemaining, voter, claimAuthor, existingVote, snapshot]);

  const vote = useCallback(
    async (choice: VoteChoice): Promise<ClaimVoteTally> => {
      if (inFlight.current || reason || !voter) {
        return tally;
      }
      inFlight.current = true;
      setSubmitting(true);

      const previous = tally;
      const optimistic = applyVote(previous, choice);
      setTally(optimistic);
      setExistingVote(choice);

      try {
        const reconciled = await submitVote({ claimId, voter, choice });
        setTally(reconciled);
        return reconciled;
      } catch (error) {
        setTally(previous);
        setExistingVote(null);
        throw error;
      } finally {
        inFlight.current = false;
        setSubmitting(false);
      }
    },
    [claimId, voter, reason, tally, submitVote],
  );

  return {
    eligible: reason === null,
    reason,
    reasonLabel: reason ? REASON_LABELS[reason] : null,
    existingVote,
    tally,
    deadline,
    timeRemaining,
    submitting,
    hasVoted: existingVote !== null,
    vote,
  };
}
