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

function formatCoverage(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
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
}

export function PolicyCard({ policy }: PolicyCardProps) {
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
            {formatCoverage(policy.coverage, policy.currency)}
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
}

export function PolicyTableRow({ policy }: PolicyTableRowProps) {
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
        {formatCoverage(policy.coverage, policy.currency)}
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

export { StatusBadge, OpenClaimIndicator, ExpiryCountdown, formatCoverage, formatDate };
