'use client';

import React from 'react';
import { useLocale } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatFixed2 } from '@/lib/format-number';

export type PolicyStatus = 'active' | 'expiring' | 'expired';
export type PolicyType = 'Auto' | 'Health' | 'Property';

export interface PolicyCardProps {
  /** Unique policy identifier */
  policyId: number;
  /** Type of insurance policy */
  type: PolicyType;
  /** Coverage amount in stroops (minor units) */
  coverageAmount: string;
  /** Asset symbol (e.g., 'XLM') */
  asset: string;
  /** Current policy status */
  status: PolicyStatus;
  /** Expiry ledger number */
  expiryLedger: number;
  /** Current ledger number for calculating time remaining */
  currentLedger?: number;
  /** Average ledger close time in seconds (default: 5) */
  avgLedgerCloseSeconds?: number;
  /** Optional click handler */
  onClick?: () => void;
  /** Optional CSS class */
  className?: string;
}

const STATUS_CONFIG: Record<
  PolicyStatus,
  { variant: 'success' | 'warning' | 'outline'; label: string }
> = {
  active: { variant: 'success', label: 'Active' },
  expiring: { variant: 'warning', label: 'Expiring Soon' },
  expired: { variant: 'outline', label: 'Expired' },
};

/**
 * Format stroops (7 decimals) to human-readable XLM amount.
 */
function formatAmount(stroops: string, locale: string, decimals = 7): string {
  const num = Number(stroops) / Math.pow(10, decimals);
  return formatFixed2(num, locale);
}

/**
 * Calculate human-readable time estimate from ledgers remaining.
 */
function estimateTimeRemaining(
  ledgersRemaining: number,
  avgCloseSeconds: number,
): string {
  if (ledgersRemaining <= 0) return 'Expired';

  const totalSeconds = ledgersRemaining * avgCloseSeconds;
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) return `~${days}d ${hours}h`;
  if (hours > 0) return `~${hours}h ${minutes}m`;
  return `~${minutes}m`;
}

/**
 * PolicyCard — compact summary for list views and dashboard widgets.
 *
 * Displays key policy details with status badge and expiry estimate.
 * Accessible with proper ARIA roles and semantic HTML.
 */
export function PolicyCard({
  policyId,
  type,
  coverageAmount,
  asset,
  status,
  expiryLedger,
  currentLedger,
  avgLedgerCloseSeconds = 5,
  onClick,
  className,
}: PolicyCardProps) {
  const locale = useLocale();
  const statusConfig = STATUS_CONFIG[status];
  const ledgersRemaining = currentLedger
    ? Math.max(0, expiryLedger - currentLedger)
    : 0;
  const timeEstimate =
    currentLedger !== undefined
      ? estimateTimeRemaining(ledgersRemaining, avgLedgerCloseSeconds)
      : '—';

  const isClickable = !!onClick;

  return (
    <Card
      className={cn(
        'transition-shadow hover:shadow-md',
        isClickable && 'cursor-pointer',
        className,
      )}
      onClick={onClick}
      role={isClickable ? 'button' : 'article'}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e: React.KeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      aria-label={`Policy ${policyId} - ${type} - ${status}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <h3 className="font-mono text-sm font-semibold text-gray-900">
              #{policyId}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">{type}</p>
          </div>
          <Badge
            variant={statusConfig.variant}
            aria-label={`Status: ${statusConfig.label}`}
          >
            {statusConfig.label}
          </Badge>
        </div>

        <dl className="space-y-2">
          <div className="flex justify-between items-baseline">
            <dt className="text-xs text-gray-500">Coverage</dt>
            <dd className="text-sm font-medium text-gray-900 tabular-nums">
              {formatAmount(coverageAmount, locale)} {asset}
            </dd>
          </div>

          <div className="flex justify-between items-baseline">
            <dt className="text-xs text-gray-500">Expires</dt>
            <dd className="text-sm font-medium text-gray-900">
              <span className="tabular-nums">{timeEstimate}</span>
              {currentLedger !== undefined && ledgersRemaining > 0 && (
                <span
                  className="ml-1 text-xs text-gray-400"
                  title={`Ledger ${expiryLedger} · ${ledgersRemaining.toLocaleString()} ledgers remaining`}
                >
                  (approx)
                </span>
              )}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
