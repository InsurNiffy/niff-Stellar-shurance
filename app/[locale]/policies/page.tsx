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
  coverage: string;
  currency: string;
  decimals: number;
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

// Centralized React Query-style config for policy queries (issue #1853).
// Policies are blockchain-backed and change infrequently, so we cache them
// longer than the default and only retry transient (non-4xx) failures.
const POLICIES_STALE_TIME_MS = 30_000;
const POLICIES_RETRY_COUNT = 3;
const POLICIES_RETRY_BASE_DELAY_MS = 1_000;

function isClientError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

function retryDelay(attemptIndex: number): number {
  return Math.min(POLICIES_RETRY_BASE_DELAY_MS * 2 ** attemptIndex, 30_000);
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

  const wholeStr = whole.toString();
  const fractionStr = decimals > 0 ? fraction.toString().padStart(decimals, '0') : '';

  let formattedWhole: string;

  try {
    formattedWhole = new Intl.NumberFormat(locale, { useGrouping: true }).format(
      BigInt(wholeStr),
    );
  } catch {
    formattedWhole = wholeStr;
  }

  const trimmedFraction = fractionStr.replace(/0+$/, '');
  const decimalSeparator = (() => {
    try {
      return (
        new Intl.NumberFormat(locale).formatToParts(0).find((p) => p.type === 'decimal')
          ?.value ?? '.'
      );
    } catch {
      return '.';
    }
  })();

  const body = trimmedFraction
    ? `${formattedWhole}${decimalSeparator}${trimmedFraction}`
    : formattedWhole;

  return negative ? `-${body}` : body;
}

function formatCurrency(amount: number, currency: string): string {
  try {
    formattedWhole = new Intl.NumberFormat(locale, { useGrouping: true }).format(
      BigInt(wholeStr),
    );
  } catch {
    formattedWhole = wholeStr;
  }

  const trimmedFraction = fractionStr.replace(/0+$/, '');
  const decimalSeparator = (() => {
    try {
      return (
        new Intl.NumberFormat(locale).formatToParts(0).find((p) => p.type === 'decimal')
          ?.value ?? '.'
      );
    } catch {
      return '.';
    }
  })();

  const body = trimmedFraction
    ? `${formattedWhole}${decimalSeparator}${trimmedFraction}`
    : formattedWhole;
  return negative ? `-${body}` : body;
}

function formatCurrency(amount: string, currency: string, decimals: number, locale: string): string {
  try {
    const formatted = formatTokenAmount(BigInt(amount), decimals, locale);
    return `${formatted} ${currency}`;
  } catch {
    return `${currency} ${amount}`;
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

interface LedgerCountdownProps {
  targetLedger: number;
  currentLedger: number;
  avgCloseSeconds: number;
}

function formatLedgerDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes} min${minutes === 1 ? '' : 's'}`);
  }
  return parts.join(' ');
}

function LedgerCountdown({ targetLedger, currentLedger, avgCloseSeconds }: LedgerCountdownProps) {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setMounted(true);
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  if (!mounted) {
    return <span className="text-gray-400">—</span>;
  }

  if (currentLedger >= targetLedger) {
    return <span className="text-gray-700">Deadline passed</span>;
  }

  const remainingLedgers = targetLedger - currentLedger;
  const remainingSeconds = remainingLedgers * avgCloseSeconds;
  const label = formatLedgerDuration(remainingSeconds);

  return (
    <span
      className="text-gray-700"
      title={`Approximately ${label} remaining (${remainingLedgers} ledgers × ${avgCloseSeconds}s)`}
    >
      ~{label} left
    </span>
  );
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

/**
 * SkeletonRow — placeholder matching a single policy list row.
 * Dimensions mirror the loaded row so layout does not shift (CLS-safe).
 * Shimmer is disabled for users who prefer reduced motion.
 */
function SkeletonRow() {
  return (
    <div
      className="rounded-lg border border-gray-200 p-4 motion-safe:animate-pulse"
      aria-hidden="true"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="h-4 w-1/3 rounded bg-gray-200" />
        <div className="h-5 w-20 rounded-full bg-gray-200" />
      </div>
      <div className="mb-2 h-3 w-2/3 rounded bg-gray-200" />
      <div className="h-3 w-1/2 rounded bg-gray-200" />
    </div>
  );
}

function PolicySkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="mt-6 space-y-3" role="status" aria-label="Loading policies">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

/**
 * EmptyState — contextual guidance shown when the policies API returns zero
 * results. Decorative SVG is aria-hidden; the gentle float animation is
 * disabled for users who prefer reduced motion (motion-safe).
 */
function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center">
      <svg
        className="mx-auto h-16 w-16 text-gray-300 motion-safe:animate-pulse"
        viewBox="0 0 64 64"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="12" y="8" width="40" height="48" rx="4" />
        <path d="M20 20h24M20 28h24M20 36h16" strokeLinecap="round" />
      </svg>
      <h2 className="mt-4 text-lg font-semibold text-gray-900">
        {filtered ? 'No policies match your filters' : 'No policies yet'}
      </h2>
      <p className="mt-2 text-sm text-gray-600">
        {filtered
          ? 'Try adjusting or clearing your filters to see more of your coverage.'
          : 'Get a quote to protect what matters and see your policies here.'}
      </p>
      <Link
        href={filtered ? '/policies' : '/quote'}
        className="mt-4 inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        {filtered ? 'Clear filters' : 'Get a quote'}
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
      if (!res.ok) {
        const err = new Error('Failed to load policies') as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      return (await res.json()) as PoliciesResponse;
    },
    [queryString],
  );

  // Fetch with retry/backoff honoring the centralized config above.
  const fetchPageWithRetry = useCallback(
    async (cursor: string | null) => {
      let attempt = 0;
      for (;;) {
        try {
          return await fetchPage(cursor);
        } catch (err) {
          if (isClientError(err) || attempt >= POLICIES_RETRY_COUNT) throw err;
          await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
          attempt += 1;
        }
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPageWithRetry(null)
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
  }, [fetchPageWithRetry]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchPageWithRetry(nextCursor);
      setPolicies((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch {
      setError('We could not load more policies. Please try again.');
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPageWithRetry, loadingMore, nextCursor]);

  const hasFilters = Boolean(status || type || asset);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Policies</h1>
        <Link
          href="/quote"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Get a quote
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Status
          <select
            value={status}
            onChange={(e) => updateFilter('status', e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="">All</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Type
          <select
            value={type}
            onChange={(e) => updateFilter('type', e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="">All</option>
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Asset
          <input
            type="text"
            value={asset}
            onChange={(e) => updateFilter('asset', e.target.value)}
            placeholder="e.g. USDC"
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
      </div>

      {error && (
        <div role="alert" className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="mt-6 space-y-3">
        {loading ? (
          <>
            <PolicySkeleton />
            <PolicySkeleton />
            <PolicySkeleton />
          </>
        ) : policies.length === 0 ? (
          <EmptyState />
        ) : (
          policies.map((policy) => (
            <Link
              key={policy.id}
              href={`/policies/${policy.id}`}
              className="block rounded-lg border border-gray-200 p-4 transition hover:border-blue-400 hover:shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">
                    {TYPE_LABELS[policy.type]}
                  </span>
                  <span className="text-xs text-gray-500">{policy.policyNumber}</span>
                </div>
                <StatusBadge status={policy.status} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-gray-500">Coverage</dt>
                  <dd className="font-medium text-gray-900">
                    {formatCurrency(policy.coverage, policy.currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Expires</dt>
                  <dd className="font-medium text-gray-900">
                    {formatCountdown(policy.expiresAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Asset</dt>
                  <dd className="font-medium text-gray-900">{policy.asset}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Claims</dt>
                  <dd>
                    <OpenClaimIndicator count={policy.openClaims} />
                  </dd>
                </div>
              </dl>
            </Link>
          ))
        )}
      </div>

      {!loading && policies.length > 0 && (
        <div className="mt-6 flex justify-center">
          {nextCursor ? (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          ) : (
            <p className="text-sm text-gray-500">You&apos;ve reached the end of the list.</p>
          )}
        </div>
      )}
    </main>
  );
}
