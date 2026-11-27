'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

type PolicyStatus = 'active' | 'grace' | 'expired' | 'terminated';
type PolicyType = 'auto' | 'home' | 'life' | 'health';

interface Policy {
  id: string;
  policyNumber: string;
  status: PolicyStatus;
  type: PolicyType;
  asset: string;
  coverage: number;
  currency: string;
  expiresAt: string;
  openClaims: number;
}

interface PoliciesResponse {
  items: Policy[];
  nextCursor: string | null;
}

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

const TYPE_LABELS: Record<PolicyType, string> = {
  auto: 'Auto',
  home: 'Home',
  life: 'Life',
  health: 'Health',
};

const STATUS_OPTIONS: PolicyStatus[] = ['active', 'grace', 'expired', 'terminated'];
const TYPE_OPTIONS: PolicyType[] = ['auto', 'home', 'life', 'health'];

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

function formatCountdown(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(diff)) return '—';
  if (diff <= 0) return 'Expired';
  const days = Math.floor(diff / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} left`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'} left`;
  const minutes = Math.max(1, Math.floor(diff / 60_000));
  return `${minutes} min left`;
}

function StatusBadge({ status }: { status: PolicyStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      <span aria-hidden="true">●</span>
      {STATUS_LABELS[status]}
    </span>
  );
}

function OpenClaimIndicator({ count }: { count: number }) {
  if (count <= 0) return <span className="text-gray-400">—</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
      <span aria-hidden="true">⚑</span>
      {count} open claim{count === 1 ? '' : 's'}
    </span>
  );
}

function PolicySkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-gray-200 p-4">
      <div className="mb-3 h-4 w-1/3 rounded bg-gray-200" />
      <div className="mb-2 h-3 w-2/3 rounded bg-gray-200" />
      <div className="h-3 w-1/2 rounded bg-gray-200" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center">
      <h2 className="text-lg font-semibold text-gray-900">No policies yet</h2>
      <p className="mt-2 text-sm text-gray-600">
        You don&apos;t have any policies matching your filters. Get a quote to protect what matters.
      </p>
      <Link
        href="/quote"
        className="mt-4 inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Get a quote
      </Link>
    </div>
  );
}

export default function PoliciesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const status = searchParams.get('status') ?? '';
  const type = searchParams.get('type') ?? '';
  const asset = searchParams.get('asset') ?? '';

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (type) params.set('type', type);
    if (asset) params.set('asset', asset);
    return params.toString();
  }, [status, type, asset]);

  const updateFilter = useCallback(
    (key: 'status' | 'type' | 'asset', value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const params = new URLSearchParams(queryString);
      if (cursor) params.set('cursor', cursor);
      const res = await fetch(`/api/policies?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load policies');
      return (await res.json()) as PoliciesResponse;
    },
    [queryString],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPage(null)
      .then((data) => {
        if (cancelled) return;
        setPolicies(data.items);
        setNextCursor(data.nextCursor);
      })
      .catch(() => {
        if (!cancelled) setError('We could not load your policies. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchPage(nextCursor);
      setPolicies((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch {
      setError('We could not load more policies. Please try again.');
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, loadingMore, nextCursor]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Your policies</h1>

      <div className="mt-6 flex flex-wrap gap-4">
        <label className="flex flex-col text-sm text-gray-700">
          Status
          <select
            value={status}
            onChange={(e) => updateFilter('status', e.target.value)}
            className="mt-1 rounded-md border border-gray-300 px-3 py-2"
          >
            <option value="">All</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-sm text-gray-700">
          Type
          <select
            value={type}
            onChange={(e) => updateFilter('type', e.target.value)}
            className="mt-1 rounded-md border border-gray-300 px-3 py-2"
          >
            <option value="">All</option>
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-sm text-gray-700">
          Asset
          <input
            type="text"
            value={asset}
            onChange={(e) => updateFilter('asset', e.target.value)}
            placeholder="e.g. 2021 Toyota"
            className="mt-1 rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-6 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-6 space-y-4">
        {loading &&
          Array.from({ length: 3 }).map((_, i) => <PolicySkeleton key={i} />)}

        {!loading && policies.length === 0 && !error && <EmptyState />}

        {!loading &&
          policies.map((policy) => (
            <article
              key={policy.id}
              className="rounded-lg border border-gray-200 p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-gray-900">
                    {TYPE_LABELS[policy.type]} · {policy.policyNumber}
                  </h2>
                  <StatusBadge status={policy.status} />
                </div>
                <OpenClaimIndicator count={policy.openClaims} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm text-gray-600 sm:grid-cols-3">
                <div>
                  <dt className="text-xs uppercase text-gray-400">Asset</dt>
                  <dd>{policy.asset}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-gray-400">Coverage</dt>
                  <dd>{formatCurrency(policy.coverage, policy.currency)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-gray-400">Expires</dt>
                  <dd>{formatCountdown(policy.expiresAt)}</dd>
                </div>
              </dl>
            </article>
          ))}
      </div>

      {nextCursor && !loading && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </main>
  );
}
