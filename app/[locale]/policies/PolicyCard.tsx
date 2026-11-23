'use client';

import Link from 'next/link';
import type { Policy, PolicyStatus } from './types';

const STATUS_LABELS: Record<PolicyStatus, string> = {
  active: 'Active',
  grace: 'Grace period',
  expired: 'Expired',
  terminated: 'Terminated',
};

const STATUS_STYLES: Record<PolicyStatus, string> = {
  active: 'bg-green-100 text-green-800 border-green-300',
  grace: 'bg-amber-100 text-amber-800 border-amber-300',
  expired: 'bg-gray-100 text-gray-700 border-gray-300',
  terminated: 'bg-red-100 text-red-800 border-red-300',
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a raw minor-unit token amount (bigint) into a locale-aware string.
 * Uses bigint/string arithmetic only — never JavaScript `number`.
 */
function formatTokenAmount(raw: bigint, decimals: number, locale: string): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;

  const fractionDigits = fraction === 0n
    ? ''
    : fraction.toString().padStart(decimals, '0').replace(/0+$/, '');

  const wholeFormatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(whole);

  const decimalSeparator = new Intl.NumberFormat(locale)
    .formatToParts(1.1)
    .find((part) => part.type === 'decimal')?.value ?? '.';

  const body = fractionDigits
    ? `${wholeFormatted}${decimalSeparator}${fractionDigits}`
    : wholeFormatted;

  return negative ? `-${body}` : body;
}

function formatCoverage(
  amount: bigint,
  decimals: number,
  currency: string,
  locale: string,
): string {
  return `${formatTokenAmount(amount, decimals, locale)} ${currency}`;
}

function daysUntil(value: string): number | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diff = date.getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function ExpiryCountdown({ expiresAt }: { expiresAt: string }) {
  const days = daysUntil(expiresAt);
  if (days === null) {
    return <span className="text-sm text-gray-600">{expiresAt}</span>;
  }
  if (days < 0) {
    return (
      <span className="text-sm text-red-700">
        Expired {Math.abs(days)} day{Math.abs(days) === 1 ? '' : 's'} ago
      </span>
    );
  }
  if (days === 0) {
    return <span className="text-sm text-amber-700">Expires today</span>;
  }
  return (
    <span className="text-sm text-gray-700">
      {days} day{days === 1 ? '' : 's'} left
    </span>
  );
}

function StatusBadge({ status }: { status: PolicyStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {STATUS_LABELS[status]}
    </span>
  );
}

function OpenClaimIndicator({ hasOpenClaim }: { hasOpenClaim: boolean }) {
  if (!hasOpenClaim) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      Open claim
    </span>
  );
}

interface PolicyCardProps {
  policy: Policy;
  decimals: number;
  locale: string;
}

export function PolicyCard({ policy, decimals, locale }: PolicyCardProps) {
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:hidden">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">{policy.type}</p>
          <p className="text-xs text-gray-500">{policy.asset}</p>
        </div>
        <StatusBadge status={policy.status} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-gray-500">Coverage</dt>
          <dd className="font-medium text-gray-900">
            {formatCoverage(policy.coverage, decimals, policy.currency, locale)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Expires</dt>
          <dd>
            <ExpiryCountdown expiresAt={policy.expiresAt} />
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex items-center justify-between gap-2">
        <OpenClaimIndicator hasOpenClaim={policy.hasOpenClaim} />
        <Link
          href={`/policies/${policy.id}`}
          className="text-sm font-medium text-blue-700 hover:underline"
        >
          View policy
        </Link>
      </div>
    </li>
  );
}

interface PolicyTableRowProps {
  policy: Policy;
  decimals: number;
  locale: string;
}

export function PolicyTableRow({ policy, decimals, locale }: PolicyTableRowProps) {
  return (
    <tr className="hidden border-b border-gray-100 last:border-0 md:table-row">
      <td className="px-4 py-3 text-sm text-gray-900">
        <div className="font-medium">{policy.type}</div>
        <div className="text-xs text-gray-500">{policy.asset}</div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={policy.status} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-900">
        {formatCoverage(policy.coverage, decimals, policy.currency, locale)}
      </td>
      <td className="px-4 py-3">
        <ExpiryCountdown expiresAt={policy.expiresAt} />
      </td>
      <td className="px-4 py-3">
        <OpenClaimIndicator hasOpenClaim={policy.hasOpenClaim} />
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/policies/${policy.id}`}
          className="text-sm font-medium text-blue-700 hover:underline"
        >
          View
        </Link>
      </td>
    </tr>
  );
}

/**
 * Skeleton placeholder matching the shape of a loaded PolicyCard.
 * Uses the same outer <li> dimensions/padding so swapping in real content
 * does not shift layout (CLS-safe). Shimmer is disabled for users who
 * prefer reduced motion.
 */
export function PolicyCardSkeleton() {
  return (
    <li
      aria-hidden="true"
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:hidden"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="h-4 w-24 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
          <div className="h-3 w-12 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
        </div>
        <div className="h-5 w-20 animate-pulse rounded-full bg-gray-200 motion-reduce:animate-none" />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-gray-500">Coverage</dt>
          <dd className="mt-1 h-4 w-28 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
        </div>
        <div>
          <dt className="text-xs text-gray-500">Expires</dt>
          <dd className="mt-1 h-4 w-20 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
        </div>
      </dl>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="h-5 w-20 animate-pulse rounded-full bg-gray-200 motion-reduce:animate-none" />
        <div className="h-4 w-20 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
      </div>
    </li>
  );
}

/**
 * Skeleton placeholder matching the shape of a loaded PolicyTableRow.
 */
export function PolicyTableRowSkeleton() {
  return (
    <tr
      aria-hidden="true"
      className="hidden border-b border-gray-100 last:border-0 md:table-row"
    >
      <td className="px-4 py-3">
        <div className="h-4 w-24 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
        <div className="mt-1 h-3 w-12 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
      </td>
      <td className="px-4 py-3">
        <div className="h-5 w-20 animate-pulse rounded-full bg-gray-200 motion-reduce:animate-none" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-28 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-20 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
      </td>
      <td className="px-4 py-3">
        <div className="h-5 w-20 animate-pulse rounded-full bg-gray-200 motion-reduce:animate-none" />
      </td>
      <td className="px-4 py-3 text-right">
        <div className="ml-auto h-4 w-10 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
      </td>
    </tr>
  );
}

export {
  StatusBadge,
  OpenClaimIndicator,
  ExpiryCountdown,
  formatCoverage,
  formatDate,
  formatTokenAmount,
};
