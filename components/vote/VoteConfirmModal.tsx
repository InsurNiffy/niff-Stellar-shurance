'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTransactionStatus } from '@/hooks/useTransactionStatus';

export type VoteOption = 'for' | 'against' | 'abstain';

export interface VoteTally {
  for: number;
  against: number;
  abstain: number;
}

export interface VoteConfirmModalProps {
  open: boolean;
  claimId: string;
  vote: VoteOption;
  tally: VoteTally;
  onClose: () => void;
  onSubmitted?: (txHash: string) => void;
}

const VOTE_LABELS: Record<VoteOption, string> = {
  for: 'For',
  against: 'Against',
  abstain: 'Abstain',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function VoteConfirmModal({
  open,
  claimId,
  vote,
  tally,
  onClose,
  onSubmitted,
}: VoteConfirmModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const { status } = useTransactionStatus(txHash);

  const dismiss = useCallback(() => {
    if (submitting) return;
    setError(null);
    setTxHash(null);
    onClose();
  }, [onClose, submitting]);

  // ESC dismisses without submitting.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, dismiss]);

  // Focus trap + initial focus. Never auto-submits on mount.
  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    if (!node) return;
    const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    (focusables[0] ?? node).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const handleConfirm = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // Build XDR from backend.
      const buildRes = await fetch('/api/vote/build-xdr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId, vote }),
      });
      if (!buildRes.ok) throw new Error('Failed to build transaction');
      const { xdr } = (await buildRes.json()) as { xdr: string };

      // Wallet signing.
      const signedXdr = await signWithWallet(xdr);

      // Submit via POST /tx/submit.
      const submitRes = await fetch('/tx/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xdr: signedXdr }),
      });
      if (!submitRes.ok) throw new Error('Failed to submit transaction');
      const { hash } = (await submitRes.json()) as { hash: string };

      setTxHash(hash);
      onSubmitted?.(hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vote submission failed');
    } finally {
      setSubmitting(false);
    }
  }, [claimId, vote, submitting, onSubmitted]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={dismiss}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vote-confirm-title"
        aria-describedby="vote-confirm-desc"
        tabIndex={-1}
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="vote-confirm-title" className="text-lg font-semibold">
          Confirm your vote
        </h2>

        <p id="vote-confirm-desc" className="mt-2 text-sm text-gray-600">
          You are about to cast a vote of{' '}
          <strong>{VOTE_LABELS[vote]}</strong> on claim{' '}
          <span className="font-mono">{claimId}</span>.
        </p>

        <div className="mt-4 rounded border border-gray-200 p-3 text-sm">
          <p className="font-medium">Current tally</p>
          <ul className="mt-1 space-y-1 text-gray-700">
            <li>For: {tally.for}</li>
            <li>Against: {tally.against}</li>
            <li>Abstain: {tally.abstain}</li>
          </ul>
        </div>

        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">This action is irreversible</p>
          <p className="mt-1">
            Once submitted and signed, your vote is recorded on-chain and cannot
            be changed, withdrawn, or re-cast.
          </p>
        </div>

        <div className="mt-4 text-sm text-gray-600">
          <p className="font-medium text-gray-800">How governance voting works</p>
          <p className="mt-1">
            Votes are weighted by governance power at the snapshot block. Your
            wallet signature authorizes the transaction; the network records the
            final result.
          </p>
        </div>

        {txHash && (
          <p className="mt-4 text-sm text-gray-700">
            Transaction status: <strong>{status ?? 'pending'}</strong>
          </p>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            disabled={submitting}
            className="rounded border border-gray-300 px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || !!txHash}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Confirm Vote'}
          </button>
        </div>
      </div>
    </div>
  );
}

async function signWithWallet(xdr: string): Promise<string> {
  const wallet = (globalThis as { freighter?: { signTransaction?: (x: string) => Promise<{ signedTxXdr: string }> } }).freighter;
  if (!wallet?.signTransaction) {
    throw new Error('Wallet not available');
  }
  const { signedTxXdr } = await wallet.signTransaction(xdr);
  return signedTxXdr;
}

export default VoteConfirmModal;
