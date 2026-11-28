'use client';

import { useTranslations } from 'next-intl';

interface AppealCountdownBadgeProps {
  /** Ledger at which the appeal window closes. */
  appealOpenDeadlineLedger: number;
  /** Current ledger height. */
  currentLedger: number;
}

/**
 * Shows how many ledgers remain to open an appeal after a Rejected claim.
 * Renders nothing once the appeal window has closed.
 */
export default function AppealCountdownBadge({
  appealOpenDeadlineLedger,
  currentLedger,
}: AppealCountdownBadgeProps) {
  const t = useTranslations('claims.appeal');

  const ledgersRemaining = appealOpenDeadlineLedger - currentLedger;

  if (ledgersRemaining <= 0) {
    return null;
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800"
      role="status"
      aria-live="polite"
    >
      {t('countdown', { ledgers: ledgersRemaining })}
    </span>
  );
}
