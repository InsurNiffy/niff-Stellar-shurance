'use client';

/**
 * useOptimisticClaims
 *
 * Manages optimistic state for claim filing and vote submission.
 *
 * After a transaction is submitted the hook:
 *   1. Immediately marks the claim row as "pending".
 *   2. Polls /api/claims/:id with exponential backoff until the indexer
 *      reflects the expected status change.
 *   3. Rolls back on timeout or hard error.
 *
 * Optimistic state is session-only (React state) — never persisted to storage.
 */

import { useCallback, useEffect } from 'react';
import {
  useOptimisticState,
  useConfirmationPoller,
  subscribeOptimisticMutations,
} from '@/lib/optimistic';
import { toast } from '@/components/ui/use-toast';
import type { ClaimBoard } from '@/lib/schemas/claims-board';

// ---------------------------------------------------------------------------
// Confirmation check
// ---------------------------------------------------------------------------

async function checkClaimStatus(
  claimId: string,
  expectedStatus: string,
  signal: AbortSignal,
): Promise<boolean> {
  const res = await fetch(`/api/claims/${encodeURIComponent(claimId)}`, {
    signal,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { status?: string };
  return data.status === expectedStatus;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseOptimisticClaimsReturn {
  /** Apply an optimistic "Processing" state after claim filing. */
  applyOptimisticClaim: (claim: ClaimBoard, txHash?: string) => void;
  /** Apply an optimistic vote count update after vote submission. */
  applyOptimisticVote: (
    claim: ClaimBoard,
    vote: 'Approve' | 'Reject',
    txHash?: string,
  ) => void;
  /** Merge server claims with optimistic overrides. */
  mergeWithOptimistic: (serverClaims: ClaimBoard[]) => ClaimBoard[];
  /** Get the optimistic status for a single claim (for badge rendering). */
  getOptimisticStatus: (claimId: string) => { status: 'pending' | 'confirmed' | 'failed'; error?: string } | undefined;
  /**
   * Roll back an optimistic entry and show a user-facing toast.
   * Pass this as the `onRollback` prop of ClaimConfirmationPoller so users
   * are notified when a mutation is reverted.
   */
  rollbackWithToast: (key: string, error: string) => void;
  /** Pending/confirmed/failed entries, for rendering pollers and badges. */
  entries: ReturnType<typeof useOptimisticState<ClaimBoard>>['entries'];
  confirm: (key: string) => void;
}

/** Minimal row used when a just-filed claim is not in the server list yet. */
function placeholderClaim(claimId: string): ClaimBoard {
  return {
    claim_id: claimId,
    policy_id: '',
    claimant: '',
    amount: '',
    details: '',
    evidence: [],
    status: 'Processing',
    voting_deadline_ledger: 0,
    approve_votes: 0,
    reject_votes: 0,
    filed_at: Math.floor(Date.now() / 1000),
    total_voters: 0,
  };
}

export function useOptimisticClaims(): UseOptimisticClaimsReturn {
  const optimistic = useOptimisticState<ClaimBoard>();

  // Subscribe to submissions from the claim wizard and vote panel. The bus is
  // in-memory only, so nothing survives a page reload.
  useEffect(() => subscribeOptimisticMutations((mutation) => {
    const claim = placeholderClaim(mutation.claimId);
    if (mutation.type === 'claim_filing') {
      optimistic.apply(mutation.claimId, 'claim_filing', claim, claim, mutation.txHash);
    } else {
      const voted: ClaimBoard = {
        ...claim,
        approve_votes: mutation.vote === 'Approve' ? 1 : 0,
        reject_votes: mutation.vote === 'Reject' ? 1 : 0,
      };
      optimistic.apply(mutation.claimId, 'vote_submission', voted, claim, mutation.txHash);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Confirm entries whose expected status is now reflected by the server.
  // Called by mergeWithOptimistic so the effect runs on every server refresh.
  const syncWithServer = useCallback(
    (serverClaims: ClaimBoard[]) => {
      optimistic.entries.forEach((entry, key) => {
        if (entry.status !== 'pending') return;
        const serverClaim = serverClaims.find((c) => c.claim_id === key);
        if (!serverClaim) return;
        const expectedStatus = entry.optimisticData.status;
        if (serverClaim.status === expectedStatus) {
          optimistic.confirm(key);
          setTimeout(() => optimistic.remove(key), 2_000);
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const applyOptimisticClaim = useCallback(
    (claim: ClaimBoard, txHash?: string) => {
      const optimisticClaim: ClaimBoard = { ...claim, status: 'Processing' };
      optimistic.apply(claim.claim_id, 'claim_filing', optimisticClaim, claim, txHash);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const applyOptimisticVote = useCallback(
    (claim: ClaimBoard, vote: 'Approve' | 'Reject', txHash?: string) => {
      const optimisticClaim: ClaimBoard = {
        ...claim,
        approve_votes: vote === 'Approve' ? claim.approve_votes + 1 : claim.approve_votes,
        reject_votes: vote === 'Reject' ? claim.reject_votes + 1 : claim.reject_votes,
      };
      optimistic.apply(claim.claim_id, 'vote_submission', optimisticClaim, claim, txHash);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const mergeWithOptimistic = useCallback(
    (serverClaims: ClaimBoard[]): ClaimBoard[] => {
      syncWithServer(serverClaims);
      const merged = serverClaims.map((c) => {
        const entry = optimistic.get(c.claim_id);
        if (!entry || entry.status === 'confirmed') return c;
        return entry.status === 'failed' ? entry.previousData : entry.optimisticData;
      });
      // A newly filed claim is not in the server list yet — show it immediately.
      optimistic.entries.forEach((entry, key) => {
        if (entry.operation !== 'claim_filing' || entry.status === 'confirmed') return;
        if (!merged.some((c) => c.claim_id === key)) {
          merged.unshift(entry.status === 'failed' ? entry.previousData : entry.optimisticData);
        }
      });
      return merged;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [optimistic.entries],
  );

  const getOptimisticStatus = useCallback(
    (claimId: string) => {
      const entry = optimistic.get(claimId);
      if (!entry) return undefined;
      return { status: entry.status, error: entry.error };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [optimistic.entries],
  );

  // Wrap rollback to show a user-facing toast notification when an optimistic
  // update is reverted due to a failed or timed-out API confirmation.
  const rollbackWithToast = useCallback((key: string, error: string) => {
    optimistic.rollback(key, error);
    toast.error(
      'Action reverted',
      error || 'The on-chain update could not be confirmed. Your previous state has been restored.',
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    applyOptimisticClaim,
    applyOptimisticVote,
    mergeWithOptimistic,
    getOptimisticStatus,
    rollbackWithToast,
    entries: optimistic.entries,
    confirm: optimistic.confirm,
  };
}

// ---------------------------------------------------------------------------
// Per-entry poller (headless component)
// ---------------------------------------------------------------------------

export interface ClaimConfirmationPollerProps {
  claimId: string;
  expectedStatus: string;
  createdAt: number;
  enabled: boolean;
  onConfirmed: (key: string) => void;
  onRollback: (key: string, error: string) => void;
}

export function ClaimConfirmationPoller({
  claimId,
  expectedStatus,
  createdAt,
  enabled,
  onConfirmed,
  onRollback,
}: ClaimConfirmationPollerProps) {
  useConfirmationPoller({
    key: claimId,
    enabled,
    createdAt,
    check: (signal) => checkClaimStatus(claimId, expectedStatus, signal),
    onConfirmed,
    onRollback,
  });
  return null;
}
