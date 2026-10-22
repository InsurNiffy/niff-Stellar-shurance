import { useEffect } from 'react';
import type { ContractTxState as TxState } from '../hooks/useContractTx';
import { StellarExplorerLink } from './ui/StellarExplorerLink';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

/**
 * Human-readable copy for each lifecycle step. Kept in sync with the
 * `TxState` union so the dialog can render every transition.
 */
const STEP_LABELS: Record<TxState, string> = {
  idle: 'Ready',
  building: 'Building transaction…',
  'awaiting-signature': 'Waiting for wallet signature…',
  submitting: 'Submitting transaction…',
  confirming: 'Confirming on-chain…',
  success: 'Transaction confirmed',
  error: 'Transaction failed',
};

/** Ordered steps used to render the progress list. */
const ORDERED_STEPS: TxState[] = [
  'building',
  'awaiting-signature',
  'submitting',
  'confirming',
  'success',
];

const STEP_INDEX: Record<TxState, number> = {
  idle: -1,
  building: 0,
  'awaiting-signature': 1,
  submitting: 2,
  confirming: 3,
  success: 4,
  error: -1,
};

export interface TxStatusDialogProps {
  /** Current lifecycle state from `useContractTx`. */
  state: TxState;
  /** Whether the dialog is visible. */
  open: boolean;
  /** Explorer URL for the confirmed transaction, if available. */
  explorerUrl?: string | null;
  /** Human-readable error message, if the transaction failed. */
  error?: string | null;
  /** Transaction hash for the Stellar Expert link. */
  transactionHash?: string | null;
  /** Available XDR diagnostic information. */
  xdrError?: string | null;
  /** Retry handler shown when the transaction failed. */
  onRetry?: () => void;
  /** Close handler. Closing never cancels an in-flight transaction. */
  onClose: () => void;
}

/**
 * Reusable status dialog for the contract transaction lifecycle.
 *
 * Closing the dialog mid-flow does not cancel the transaction: the hook keeps
 * tracking it in the background and the caller can re-open this dialog to see
 * the final state.
 */
export function TxStatusDialog({
  state,
  open,
  explorerUrl,
  error,
  transactionHash,
  xdrError,
  onRetry,
  onClose,
}: TxStatusDialogProps) {
  useEffect(() => {
    if (!open || state !== 'success') return;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([80, 40, 80]);
    }
    const timer = window.setTimeout(onClose, 10_000);
    return () => window.clearTimeout(timer);
  }, [open, state, onClose]);

  const activeIndex = STEP_INDEX[state];
  const isError = state === 'error';
  const isSuccess = state === 'success';

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent hideCloseButton className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transaction status</DialogTitle>
          <DialogDescription className="sr-only">
            Current progress of your Stellar transaction.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-3" aria-label="Transaction progress">
          {ORDERED_STEPS.map((step, index) => {
            const isDone = isSuccess || (activeIndex > index && !isError);
            const isActive = !isError && activeIndex === index;
            return (
              <li
                key={step}
                className={`flex items-center gap-3 text-sm ${isDone ? 'text-primary' : isActive ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
                aria-current={isActive ? 'step' : undefined}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs" aria-hidden="true">
                  {isDone ? '✓' : index + 1}
                </span>
                <span>{STEP_LABELS[step]}</span>
              </li>
            );
          })}
        </ol>

        {isError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
            <p>{error ?? 'Something went wrong. Please try again.'}</p>
            {xdrError && <pre className="mt-2 whitespace-pre-wrap break-all text-xs">XDR detail: {xdrError}</pre>}
          </div>
        )}

        {isSuccess && (transactionHash || explorerUrl) && (
          transactionHash ? (
            <StellarExplorerLink type="tx" value={transactionHash} label="View on Stellar Expert" />
          ) : (
            <a
              className="inline-flex items-center text-sm underline underline-offset-4"
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on Stellar Expert ↗
            </a>
          )
        )}

        <DialogFooter>
          {isError && onRetry && (
            <button
              type="button"
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
              onClick={onRetry}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            onClick={onClose}
          >
            {isSuccess || isError ? 'Close' : 'Continue in background'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default TxStatusDialog;
