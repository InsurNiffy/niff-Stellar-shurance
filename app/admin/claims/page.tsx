'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminRoleGuard from '@/components/admin/AdminRoleGuard';
import { api } from '@/lib/api';

type ClaimStatus = 'disputed' | 'resolved' | 'frozen';

interface DisputedClaim {
  id: string;
  claimant: string;
  amount: string;
  reason: string;
  status: ClaimStatus;
  createdAt: string;
}

type ClaimAction = 'resolve' | 'freeze';

const STATUS_STYLES: Record<ClaimStatus, string> = {
  disputed: 'bg-amber-100 text-amber-800',
  resolved: 'bg-emerald-100 text-emerald-800',
  frozen: 'bg-slate-200 text-slate-700',
};

export default function AdminClaimsPage() {
  const [claims, setClaims] = useState<DisputedClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | ClaimStatus>('disputed');

  const loadClaims = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<DisputedClaim[]>('/admin/claims');
      setClaims(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load disputed claims');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClaims();
  }, [loadClaims]);

  const handleAction = useCallback(
    async (claim: DisputedClaim, action: ClaimAction) => {
      setPendingId(claim.id);
      setError(null);
      try {
        const updated = await api.post<DisputedClaim>(
          `/admin/claims/${claim.id}/${action}`,
          {},
        );
        setClaims((prev) =>
          prev.map((item) => (item.id === claim.id ? updated : item)),
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : `Failed to ${action} claim`,
        );
      } finally {
        setPendingId(null);
      }
    },
    [],
  );

  const visibleClaims = useMemo(
    () =>
      filter === 'all'
        ? claims
        : claims.filter((claim) => claim.status === filter),
    [claims, filter],
  );

  return (
    <AdminRoleGuard>
      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Disputed Claims</h1>
            <p className="text-sm text-slate-500">
              Review disputed claims and resolve or freeze them.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="claim-filter" className="text-sm text-slate-600">
              Status
            </label>
            <select
              id="claim-filter"
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as 'all' | ClaimStatus)
              }
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            >
              <option value="all">All</option>
              <option value="disputed">Disputed</option>
              <option value="resolved">Resolved</option>
              <option value="frozen">Frozen</option>
            </select>
            <button
              type="button"
              onClick={() => void loadClaims()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>
        </header>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-slate-500">Loading disputed claims…</p>
        ) : visibleClaims.length === 0 ? (
          <p className="text-sm text-slate-500">No claims match this filter.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Claimant</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleClaims.map((claim) => {
                  const busy = pendingId === claim.id;
                  return (
                    <tr key={claim.id}>
                      <td className="px-4 py-3 font-mono text-xs">
                        {claim.claimant}
                      </td>
                      <td className="px-4 py-3">{claim.amount}</td>
                      <td className="px-4 py-3">{claim.reason}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[claim.status]}`}
                        >
                          {claim.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {new Date(claim.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={busy || claim.status === 'resolved'}
                            onClick={() => void handleAction(claim, 'resolve')}
                            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Resolve
                          </button>
                          <button
                            type="button"
                            disabled={busy || claim.status === 'frozen'}
                            onClick={() => void handleAction(claim, 'freeze')}
                            className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Freeze
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminRoleGuard>
  );
}
