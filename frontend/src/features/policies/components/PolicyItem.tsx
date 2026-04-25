'use client';

import Link from 'next/link';
import { SECS_PER_LEDGER } from '@/lib/schemas/vote';
import { PendingBadge } from '@/components/ui/PendingBadge';
import type { OptimisticStatus } from '@/lib/optimistic';
import type { PolicyDto } from '../api';
import { formatTokenAmount } from '@/lib/formatTokenAmount';

/** Format minor-unit token amount using decimals from the coverage_summary manifest. */
export function formatXlm(stroops: string, locale?: string, decimals = 7): string {
  return formatTokenAmount(stroops, decimals, locale ?? 'en-US')
}

/** Approximate wall-clock seconds remaining from ledgers_remaining. */
function expiryLabel(ledgersRemaining: number, graceLedgersRemaining?: number): string {
  if (ledgersRemaining > 0) {
    const totalSecs = ledgersRemaining * SECS_PER_LEDGER;
    const days = Math.floor(totalSecs / 86400);
    if (days > 0) return `${days}d remaining`;
    const hours = Math.floor(totalSecs / 3600);
    if (hours > 0) return `${hours}h remaining`;
    return `${Math.floor(totalSecs / 60)}m remaining`;
  }
  if (graceLedgersRemaining !== undefined && graceLedgersRemaining > 0) {
    const totalSecs = graceLedgersRemaining * SECS_PER_LEDGER;
    const hours = Math.floor(totalSecs / 3600);
    if (hours > 0) return `Grace period — ${hours}h to renew`;
    return `Grace period — ${Math.floor(totalSecs / 60)}m to renew`;
  }
  return 'Expired';
}

// Ledger constants — must match contracts/niffyinsure/src/ledger.rs
// RENEWAL_WINDOW_LEDGERS = 3 * 17_280 = 51_840 (~3 days)
// DEFAULT_GRACE_PERIOD_LEDGERS = 17_280 (~1 day)
// The backend expiry_countdown.ledgers_remaining is negative when past end_ledger.
const RENEWAL_WINDOW_LEDGERS = 51_840;
const DEFAULT_GRACE_PERIOD_LEDGERS = 17_280;

interface PolicyCardProps {
  policy: PolicyDto;
  onRenew: (policy: PolicyDto) => void;
  onTerminate: (policy: PolicyDto) => void;
  currentLedger: number | null;
  /** Admin-configured grace period in ledgers. Defaults to DEFAULT_GRACE_PERIOD_LEDGERS when not provided. */
  gracePeriodLedgers?: number;
  optimisticStatus?: OptimisticStatus;
  optimisticError?: string;
}

/**
 * Card layout — used on mobile and when the user selects card view.
 * Actions are disabled with tooltip text when contract rules forbid them.
 *
 * Renewal window: [end - RENEWAL_WINDOW_LEDGERS, end + grace_period_ledgers)
 * This matches the on-chain check in contracts/niffyinsure/src/ledger.rs:
 *   is_in_renewal_window_with_grace(now, end, RENEWAL_WINDOW_LEDGERS, grace)
 */
export function PolicyCard({ policy, onRenew, onTerminate, currentLedger, gracePeriodLedgers, optimisticStatus, optimisticError }: PolicyCardProps) {
  const { coverage_summary: cs, expiry_countdown: ec } = policy;
  const grace = gracePeriodLedgers ?? DEFAULT_GRACE_PERIOD_LEDGERS;

  // ledgers_remaining is negative when past end_ledger (expired but possibly in grace)
  const inRenewalWindow = ec.ledgers_remaining <= RENEWAL_WINDOW_LEDGERS;
  const inGracePeriod = ec.ledgers_remaining <= 0 && ec.ledgers_remaining > -grace;
  const graceLedgersRemaining = inGracePeriod ? ec.ledgers_remaining + grace : undefined;

  const canRenew = policy.is_active && (inRenewalWindow || inGracePeriod);
  const renewDisabledReason = !policy.is_active
    ? 'Policy is not active'
    : ec.ledgers_remaining <= -grace
      ? 'Grace period has ended — policy has lapsed'
      : ec.ledgers_remaining > RENEWAL_WINDOW_LEDGERS
        ? 'Renewal opens within 3 days of expiry'
        : undefined;

  // Terminate gate: only active policies can be terminated
  const canTerminate = policy.is_active;
  const terminateDisabledReason = !policy.is_active ? 'Policy is already inactive' : undefined;

  const statusLabel = policy.is_active
    ? inGracePeriod ? 'Grace Period' : 'Active'
    : 'Expired';
  const statusClass = policy.is_active
    ? inGracePeriod
      ? 'bg-yellow-100 text-yellow-800'
      : 'bg-green-100 text-green-800'
    : 'bg-gray-100 text-gray-600';

  return (
    <article
      aria-label={`Policy ${policy.policy_id}`}
      className="rounded-lg border border-gray-200 bg-white p-4 space-y-3 shadow-sm"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link
            href={`/policy/${encodeURIComponent(policy.holder)}/${policy.policy_id}`}
            className="font-mono text-sm font-semibold text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
          >
            #{policy.policy_id}
          </Link>
          <p className="text-xs text-gray-500 mt-0.5">{policy.policy_type} · {policy.region} risk</p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}
          aria-label={`Status: ${statusLabel}`}
        >
          {statusLabel}
        </span>
        {optimisticStatus && optimisticStatus !== 'confirmed' && (
          <PendingBadge status={optimisticStatus} error={optimisticError} />
        )}
      </div>

      {/* Amounts */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div>
          <dt className="text-xs text-gray-500">Coverage</dt>
          <dd className="font-medium text-gray-900">{formatXlm(cs.coverage_amount)} {cs.currency}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Premium / yr</dt>
          <dd className="font-medium text-gray-900">{formatXlm(cs.premium_amount)} {cs.currency}</dd>
        </div>
      </dl>

      {/* Expiry */}
      <div className="text-xs text-gray-500 space-y-0.5">
        <p>
          <span className="font-medium text-gray-700">{expiryLabel(ec.ledgers_remaining, graceLedgersRemaining)}</span>
          {' '}· ledger {ec.end_ledger}
        </p>
        {currentLedger !== null && (
          <p className="text-gray-400">
            Current ledger: {currentLedger}
            {' '}·{' '}
            <span title="Horizon poll may lag 1–3 ledgers (~5–15 s) behind chain finality">
              ⓘ indexer may lag ~15 s
            </span>
          </p>
        )}
      </div>

      {/* Claims summary */}
      {policy.claims.length > 0 && (
        <p className="text-xs text-gray-500">
          {policy.claims.length} claim{policy.claims.length !== 1 ? 's' : ''} filed
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <ActionButton
          label="Renew"
          enabled={canRenew}
          disabledReason={renewDisabledReason}
          onClick={() => onRenew(policy)}
          className="border-blue-600 text-blue-700 hover:bg-blue-50"
        />
        <ActionButton
          label="Terminate"
          enabled={canTerminate}
          disabledReason={terminateDisabledReason}
          onClick={() => onTerminate(policy)}
          className="border-red-500 text-red-600 hover:bg-red-50"
        />
      </div>
    </article>
  );
}

/**
 * Row layout — used in table view on desktop.
 */
export function PolicyRow({ policy, onRenew, onTerminate, currentLedger, gracePeriodLedgers, optimisticStatus, optimisticError }: PolicyCardProps) {
  const { coverage_summary: cs, expiry_countdown: ec } = policy;
  const grace = gracePeriodLedgers ?? DEFAULT_GRACE_PERIOD_LEDGERS;

  const inRenewalWindow = ec.ledgers_remaining <= RENEWAL_WINDOW_LEDGERS;
  const inGracePeriod = ec.ledgers_remaining <= 0 && ec.ledgers_remaining > -grace;
  const graceLedgersRemaining = inGracePeriod ? ec.ledgers_remaining + grace : undefined;

  const canRenew = policy.is_active && (inRenewalWindow || inGracePeriod);
  const renewDisabledReason = !policy.is_active
    ? 'Policy is not active'
    : ec.ledgers_remaining <= -grace
      ? 'Grace period has ended — policy has lapsed'
      : ec.ledgers_remaining > RENEWAL_WINDOW_LEDGERS
        ? 'Renewal opens within 3 days of expiry'
        : undefined;

  const canTerminate = policy.is_active;
  const terminateDisabledReason = !policy.is_active ? 'Policy is already inactive' : undefined;

  const statusLabel = policy.is_active
    ? inGracePeriod ? 'Grace Period' : 'Active'
    : 'Expired';
  const statusClass = policy.is_active
    ? inGracePeriod
      ? 'bg-yellow-100 text-yellow-800'
      : 'bg-green-100 text-green-800'
    : 'bg-gray-100 text-gray-600';

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <td className="px-4 py-3 text-sm">
        <Link
          href={`/policy/${encodeURIComponent(policy.holder)}/${policy.policy_id}`}
          className="font-mono font-semibold text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
        >
          #{policy.policy_id}
        </Link>
        <p className="text-xs text-gray-500">{policy.policy_type}</p>
      </td>
      <td className="px-4 py-3 text-sm">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}
        >
          {statusLabel}
        </span>
        {optimisticStatus && optimisticStatus !== 'confirmed' && (
          <PendingBadge status={optimisticStatus} error={optimisticError} />
        )}
      </td>
      <td className="px-4 py-3 text-sm text-right tabular-nums">
        {formatXlm(cs.coverage_amount)} {cs.currency}
      </td>
      <td className="px-4 py-3 text-sm text-right tabular-nums">
        {formatXlm(cs.premium_amount)} {cs.currency}
      </td>
      <td className="px-4 py-3 text-sm">
        <span title={currentLedger !== null ? `Current ledger: ${currentLedger} · indexer may lag ~15 s` : undefined}>
          {expiryLabel(ec.ledgers_remaining, graceLedgersRemaining)}
        </span>
      </td>
      <td className="px-4 py-3 text-sm">
        <div className="flex gap-2">
          <ActionButton
            label="Renew"
            enabled={canRenew}
            disabledReason={renewDisabledReason}
            onClick={() => onRenew(policy)}
            className="border-blue-600 text-blue-700 hover:bg-blue-50"
          />
          <ActionButton
            label="Terminate"
            enabled={canTerminate}
            disabledReason={terminateDisabledReason}
            onClick={() => onTerminate(policy)}
            className="border-red-500 text-red-600 hover:bg-red-50"
          />
        </div>
      </td>
    </tr>
  );
}

interface ActionButtonProps {
  label: string;
  enabled: boolean;
  disabledReason?: string;
  onClick: () => void;
  className?: string;
}

function ActionButton({ label, enabled, disabledReason, onClick, className = '' }: ActionButtonProps) {
  return (
    <span title={!enabled ? disabledReason : undefined} className="inline-block">
      <button
        type="button"
        onClick={onClick}
        disabled={!enabled}
        aria-disabled={!enabled}
        aria-label={!enabled ? `${label} — ${disabledReason}` : label}
        className={[
          'min-h-[44px] min-w-[44px] rounded border px-3 py-1.5 text-xs font-medium',
          'focus:outline-none focus:ring-2 focus:ring-offset-1',
          enabled ? className : 'border-gray-200 text-gray-400 cursor-not-allowed',
          'disabled:opacity-50 disabled:pointer-events-none',
        ].join(' ')}
      >
        {label}
      </button>
    </span>
  );
}
