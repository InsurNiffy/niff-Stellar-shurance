'use client';

import { Clock } from 'lucide-react';
import { useAppealCountdown } from '@/features/claims/hooks/useAppealCountdown';

export interface AppealCountdownBadgeProps {
  /** appeal_open_deadline_ledger from the claim. */
  appealDeadlineLedger: number | undefined;
  /** Current ledger from useLatestLedger(). */
  currentLedger: number;
}

/**
 * AppealCountdownBadge — renders a compact inline countdown showing how long
 * a claimant has left to file an appeal.
 *
 * Renders null when no appeal deadline is set or when the window has already closed.
 * Placed adjacent to AppealButton in claim-vote-panel.tsx.
 */
export function AppealCountdownBadge({
  appealDeadlineLedger,
  currentLedger,
}: AppealCountdownBadgeProps) {
  const countdown = useAppealCountdown(appealDeadlineLedger, currentLedger);

  if (!countdown || !countdown.isOpen) return null;

  return (
    <p
      className="flex items-center gap-1 text-xs text-amber-700"
      aria-live="polite"
      title={`Appeal deadline: ledger ${appealDeadlineLedger} · current ~${currentLedger}`}
    >
      <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>
        Appeal window closes in{' '}
        <span className="font-medium tabular-nums">{countdown.label}</span>
        <span className="ml-1 text-muted-foreground">(approximate)</span>
      </span>
    </p>
  );
}
