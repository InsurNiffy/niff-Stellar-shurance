'use client';

import { useEffect, useState } from 'react';

interface AppealConfirmModalProps {
  open: boolean;
  claimId: string;
  appealOpenDeadlineLedger: number;
  currentLedger: number;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}

export function AppealConfirmModal({
  open,
  claimId,
  appealOpenDeadlineLedger,
  currentLedger,
  onClose,
  onConfirm,
}: AppealConfirmModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const ledgersRemaining = Math.max(0, appealOpenDeadlineLedger - currentLedger);
  const deadlinePassed = ledgersRemaining <= 0;

  async function handleConfirm() {
    if (deadlinePassed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit appeal');
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="appeal-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <h2 id="appeal-confirm-title" className="text-lg font-semibold text-gray-900">
          Open an appeal for claim {claimId}
        </h2>

        <div className="mt-4 space-y-3 text-sm text-gray-700">
          <p>
            Appeals are reviewed by an <strong>elevated quorum</strong> of arbiters. A
            larger share of the arbiter panel must vote to reach a decision, so review
            may take longer than the original claim.
          </p>
          <p>
            The appeal window is <strong>shorter</strong> than the original claim
            window. You must open the appeal before the deadline ledger; once it
            passes, appeals can no longer be submitted.
          </p>
          <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
            {deadlinePassed
              ? 'The appeal window has closed. You can no longer open an appeal.'
              : `${ledgersRemaining} ledger${ledgersRemaining === 1 ? '' : 's'} remaining to open your appeal (deadline ledger ${appealOpenDeadlineLedger}).`}
          </p>
        </div>

        {error ? (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={deadlinePassed || submitting}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Confirm appeal'}
          </button>
        </div>
      </div>
    </div>
  );
}
