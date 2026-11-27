'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

const PAGE_SIZE = 10;

type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'expired';
type ClaimSeverity = 'low' | 'medium' | 'high' | 'critical';

interface Claim {
  id: string;
  policyId: string;
  policyType: string;
  amount: string;
  status: ClaimStatus;
  severity: ClaimSeverity;
  votesFor: number;
  votesAgainst: number;
  quorum: number;
  deadline: string;
}

interface ClaimsPage {
  claims: Claim[];
  nextCursor: string | null;
}

interface ClaimFilters {
  status: ClaimStatus | 'all';
  severity: ClaimSeverity | 'all';
  search: string;
}

async function fetchClaims(
  filters: ClaimFilters,
  cursor: string | null,
): Promise<ClaimsPage> {
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_SIZE));
  if (cursor) params.set('cursor', cursor);
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.severity !== 'all') params.set('severity', filters.severity);
  if (filters.search.trim()) params.set('search', filters.search.trim());

  const res = await fetch(`/api/claims?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to load claims');
  return (await res.json()) as ClaimsPage;
}

function useClaims(filters: ClaimFilters) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [pages, setPages] = useState<ClaimsPage[]>([]);

  const query = useQuery({
    queryKey: ['claims', filters, cursor],
    queryFn: () => fetchClaims(filters, cursor),
  });

  const claims = useMemo(() => {
    const seen = new Set<string>();
    const merged: Claim[] = [];
    for (const page of pages) {
      for (const claim of page.claims) {
        if (!seen.has(claim.id)) {
          seen.add(claim.id);
          merged.push(claim);
        }
      }
    }
    return merged;
  }, [pages]);

  const reset = () => {
    setPages([]);
    setCursor(null);
  };

  const loadMore = () => {
    if (!query.data) return;
    setPages((prev) => [...prev, query.data]);
    setCursor(query.data.nextCursor);
  };

  return {
    claims,
    isLoading: query.isLoading,
    isError: query.isError,
    hasMore: Boolean(query.data?.nextCursor),
    loadMore,
    reset,
  };
}

const STATUS_STYLES: Record<ClaimStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  expired: 'bg-gray-100 text-gray-700',
};

function StatusBadge({ status }: { status: ClaimStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

function QuorumBar({ votesFor, votesAgainst, quorum }: { votesFor: number; votesAgainst: number; quorum: number }) {
  const total = votesFor + votesAgainst;
  const pct = quorum > 0 ? Math.min(100, Math.round((total / quorum) * 100)) : 0;
  return (
    <div className="w-32">
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500">
        {total}/{quorum} ({pct}%)
      </span>
    </div>
  );
}

function DeadlineCountdown({ deadline }: { deadline: string }) {
  const ms = new Date(deadline).getTime() - Date.now();
  if (Number.isNaN(ms)) return <span className="text-xs text-gray-500">—</span>;
  if (ms <= 0) return <span className="text-xs text-red-600">Expired</span>;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return (
    <span className="text-xs text-gray-600">
      {days > 0 ? `${days}d ${hours}h` : `${hours}h`}
    </span>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded bg-gray-100" />
      ))}
    </div>
  );
}

export function ClaimsBoard() {
  const [filters, setFilters] = useState<ClaimFilters>({
    status: 'all',
    severity: 'all',
    search: '',
  });
  const { claims, isLoading, isError, hasMore, loadMore, reset } = useClaims(filters);

  const updateFilter = <K extends keyof ClaimFilters>(key: K, value: ClaimFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    reset();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Claims</h1>

      <div className="flex flex-wrap gap-3">
        <select
          aria-label="Filter by status"
          className="rounded border px-3 py-2 text-sm"
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value as ClaimFilters['status'])}
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="expired">Expired</option>
        </select>

        <select
          aria-label="Filter by severity"
          className="rounded border px-3 py-2 text-sm"
          value={filters.severity}
          onChange={(e) => updateFilter('severity', e.target.value as ClaimFilters['severity'])}
        >
          <option value="all">All severities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>

        <input
          aria-label="Search by claim or policy ID"
          className="flex-1 rounded border px-3 py-2 text-sm"
          placeholder="Search claim ID or policy ID"
          value={filters.search}
          onChange={(e) => updateFilter('search', e.target.value)}
        />
      </div>

      {isLoading && claims.length === 0 ? (
        <SkeletonRows />
      ) : isError ? (
        <p className="text-sm text-red-600">Failed to load claims.</p>
      ) : claims.length === 0 ? (
        <div className="rounded border border-dashed p-8 text-center text-sm text-gray-500">
          No claims match the current filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full divide-y text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Claim ID</th>
                <th className="px-3 py-2">Policy type</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Quorum</th>
                <th className="px-3 py-2">Deadline</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {claims.map((claim) => (
                <tr key={claim.id}>
                  <td className="px-3 py-2 font-mono text-xs">{claim.id}</td>
                  <td className="px-3 py-2">{claim.policyType}</td>
                  <td className="px-3 py-2">{claim.amount}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={claim.status} />
                  </td>
                  <td className="px-3 py-2">
                    <QuorumBar
                      votesFor={claim.votesFor}
                      votesAgainst={claim.votesAgainst}
                      quorum={claim.quorum}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <DeadlineCountdown deadline={claim.deadline} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            className="rounded border px-4 py-2 text-sm hover:bg-gray-50"
            onClick={loadMore}
            disabled={isLoading}
          >
            {isLoading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ClaimsPage() {
  return <ClaimsBoard />;
}
