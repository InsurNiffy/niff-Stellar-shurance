import type { OptimisticStatus } from '@/lib/optimistic';

interface PendingBadgeProps {
  status: OptimisticStatus;
  error?: string;
}

/**
 * PendingBadge — shown on rows/cards that have an in-flight optimistic update.
 *
 * - pending  → animated yellow "Pending" pill
 * - failed   → red "Failed" pill with optional error tooltip
 * - confirmed → green "Confirmed" pill (briefly shown before parent removes entry)
 */
export function PendingBadge({ status, error }: PendingBadgeProps) {
  if (status === 'pending') {
    return (
      <span
        aria-label="Transaction pending indexer confirmation"
        title="Waiting for indexer confirmation (~15 s)"
        className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 animate-pulse"
      >
        <span aria-hidden="true">⏳</span> Pending
      </span>
    );
  }

  if (status === 'failed') {
    return (
      <span
        aria-label={`Transaction failed${error ? `: ${error}` : ''}`}
        title={error ?? 'Transaction could not be confirmed'}
        className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
      >
        <span aria-hidden="true">✕</span> Failed
      </span>
    );
  }

  // confirmed
  return (
    <span
      aria-label="Transaction confirmed"
      className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
    >
      <span aria-hidden="true">✓</span> Confirmed
    </span>
  );
}
