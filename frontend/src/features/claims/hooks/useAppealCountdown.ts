'use client';

import { useMemo } from 'react';
import { SECS_PER_LEDGER } from '@/lib/schemas/vote';

export interface AppealCountdownResult {
  /** Whether the appeal window is still open. */
  isOpen: boolean;
  /** Ledgers remaining until the appeal deadline. */
  ledgersRemaining: number;
  /** Approximate seconds remaining. */
  secondsRemaining: number;
  /** Human-readable label such as "~2d 3h 12m" or "Expired". */
  label: string;
}

/**
 * useAppealCountdown — computes a human-readable countdown to an appeal filing deadline.
 *
 * Driven by `useLatestLedger` (passed in as currentLedger) and the claim's
 * `appeal_open_deadline_ledger` field.  Returns null when the deadline is not set.
 *
 * The estimate is approximate: ledger close times vary around the network average
 * of ~5 s.  The "~" prefix and "(approximate)" annotation make this explicit.
 */
export function useAppealCountdown(
  appealDeadlineLedger: number | undefined,
  currentLedger: number,
): AppealCountdownResult | null {
  return useMemo(() => {
    if (appealDeadlineLedger == null) return null;

    const ledgersRemaining = Math.max(0, appealDeadlineLedger - currentLedger + 1);
    const secondsRemaining = ledgersRemaining * SECS_PER_LEDGER;
    const isOpen = currentLedger <= appealDeadlineLedger;

    if (!isOpen) {
      return {
        isOpen: false,
        ledgersRemaining: 0,
        secondsRemaining: 0,
        label: 'Expired',
      };
    }

    const days = Math.floor(secondsRemaining / 86400);
    const hours = Math.floor((secondsRemaining % 86400) / 3600);
    const minutes = Math.floor((secondsRemaining % 3600) / 60);

    const segments: string[] = [];
    if (days > 0) segments.push(`${days}d`);
    if (hours > 0 || days > 0) segments.push(`${hours}h`);
    segments.push(`${minutes}m`);

    return {
      isOpen: true,
      ledgersRemaining,
      secondsRemaining,
      label: `~${segments.join(' ')}`,
    };
  }, [appealDeadlineLedger, currentLedger]);
}
