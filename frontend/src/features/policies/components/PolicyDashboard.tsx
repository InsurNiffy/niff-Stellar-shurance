'use client';

import { useCallback, useState } from 'react';
import { useWallet } from '@/hooks/use-wallet';
import { useLatestLedger } from '@/hooks/use-latest-ledger';
import { getConfig } from '@/config/env';
import { usePolicies } from '../hooks/usePolicies';
import { PolicyCard, PolicyRow } from './PolicyItem';
import { PolicyListSkeleton, PolicyEmptyState, PolicyErrorState } from './PolicyStates';
import { RenewModal } from './RenewModal';
import { TerminateModal } from './TerminateModal';
import type { PolicyDto, PolicyStatusFilter, PolicySortField } from '../api';

const SORT_OPTIONS: { value: PolicySortField; label: string }[] = [
  { value: 'expiry', label: 'Expiry (soonest)' },
  { value: 'coverage', label: 'Coverage (highest)' },
  { value: 'premium', label: 'Premium (highest)' },
];

export function PolicyDashboard() {
  const { address } = useWallet();
  const { network } = getConfig();
  const currentLedger = useLatestLedger();

  const [status, setStatus] = useState<PolicyStatusFilter>('all');
  const [sort, setSort] = useState<PolicySortField>('expiry');
  const [layout, setLayout] = useState<'row' | 'card'>('row');

  const [renewTarget, setRenewTarget] = useState<PolicyDto | null>(null);
  const [terminateTarget, setTerminateTarget] = useState<PolicyDto | null>(null);

  const { policies, total, pageIndex, hasNextPage, hasPrevPage, loading, error, goToPage, retry } =
    usePolicies(address, network, status, sort);

  const handleRenew = useCallback((policy: PolicyDto) => setRenewTarget(policy), []);
  const handleTerminate = useCallback((policy: PolicyDto) => setTerminateTarget(policy), []);

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <section aria-label="My policies" className="space-y-4">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Status filter */}
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Status
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value as PolicyStatusFilter); goToPage(0); }}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Filter by policy status"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
          </select>
        </label>

        {/* Sort */}
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Sort by
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as PolicySortField)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Sort policies"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        {/* Layout toggle */}
        <div
          role="group"
          aria-label="Layout"
          className="ml-auto flex rounded border border-gray-300 overflow-hidden"
        >
          <LayoutButton active={layout === 'row'} onClick={() => setLayout('row')} label="Table view" icon="☰" />
          <LayoutButton active={layout === 'card'} onClick={() => setLayout('card')} label="Card view" icon="⊞" />
        </div>
      </div>

      {/* ── Count ───────────────────────────────────────────────────── */}
      {!loading && !error && (
        <p className="text-xs text-gray-500" aria-live="polite">
          {total} {total === 1 ? 'policy' : 'policies'}
          {status !== 'all' ? ` · ${status}` : ''}
        </p>
      )}

      {/* ── Content ─────────────────────────────────────────────────── */}
      {loading ? (
        <PolicyListSkeleton layout={layout} />
      ) : error ? (
        <PolicyErrorState message={error} onRetry={retry} />
      ) : policies.length === 0 ? (
        <PolicyEmptyState filter={status === 'all' ? 'all' : status} />
      ) : layout === 'card' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {policies.map((p) => (
            <PolicyCard
              key={`${p.holder}:${p.policy_id}`}
              policy={p}
              onRenew={handleRenew}
              onTerminate={handleTerminate}
              currentLedger={currentLedger}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Policy</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Coverage</th>
                <th className="px-4 py-3 text-right">Premium / yr</th>
                <th className="px-4 py-3 text-left">Expiry</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <PolicyRow
                  key={`${p.holder}:${p.policy_id}`}
                  policy={p}
                  onRenew={handleRenew}
                  onTerminate={handleTerminate}
                  currentLedger={currentLedger}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ──────────────────────────────────────────────── */}
      {!loading && !error && totalPages > 1 && (
        <nav aria-label="Policy pages" className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => goToPage(pageIndex - 1)}
            disabled={!hasPrevPage}
            aria-label="Previous page"
            className="min-h-[44px] min-w-[44px] rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span aria-live="polite" className="text-sm text-gray-700">
            Page {pageIndex + 1} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => goToPage(pageIndex + 1)}
            disabled={!hasNextPage}
            aria-label="Next page"
            className="min-h-[44px] min-w-[44px] rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </nav>
      )}

      {/* ── Action modals ───────────────────────────────────────────── */}
      {renewTarget && (
        <RenewModal policy={renewTarget} onClose={() => setRenewTarget(null)} />
      )}
      {terminateTarget && (
        <TerminateModal policy={terminateTarget} onClose={() => setTerminateTarget(null)} />
      )}
    </section>
  );
}

function LayoutButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={[
        'px-3 py-2 text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500',
        active ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
      ].join(' ')}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
