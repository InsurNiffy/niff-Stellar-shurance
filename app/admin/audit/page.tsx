'use client';

import { useMemo, useState } from 'react';
import { AdminRoleGuard } from '@/components/admin/AdminRoleGuard';

type AuditAction = 'governance' | 'voter' | 'claim' | 'auth';

interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: AuditAction;
  detail: string;
}

const AUDIT_LOG: AuditEntry[] = [
  { id: 'a1', timestamp: '2024-06-01T10:12:00Z', actor: 'admin.alice', action: 'governance', detail: 'Updated quorum to 60%' },
  { id: 'a2', timestamp: '2024-06-01T10:45:00Z', actor: 'admin.bob', action: 'voter', detail: 'Added voter GABC...XYZ' },
  { id: 'a3', timestamp: '2024-06-02T08:03:00Z', actor: 'admin.alice', action: 'claim', detail: 'Resolved claim #1042' },
  { id: 'a4', timestamp: '2024-06-02T09:20:00Z', actor: 'admin.carol', action: 'auth', detail: 'Failed admin login attempt' },
  { id: 'a5', timestamp: '2024-06-03T11:00:00Z', actor: 'admin.bob', action: 'governance', detail: 'Changed voting duration to 72h' },
  { id: 'a6', timestamp: '2024-06-03T12:30:00Z', actor: 'admin.alice', action: 'voter', detail: 'Removed voter GDEF...ABC' },
  { id: 'a7', timestamp: '2024-06-04T14:15:00Z', actor: 'admin.carol', action: 'claim', detail: 'Froze claim #1050' },
  { id: 'a8', timestamp: '2024-06-04T15:40:00Z', actor: 'admin.bob', action: 'governance', detail: 'Updated fee config' },
  { id: 'a9', timestamp: '2024-06-05T07:05:00Z', actor: 'admin.alice', action: 'auth', detail: 'Successful admin login' },
  { id: 'a10', timestamp: '2024-06-05T09:50:00Z', actor: 'admin.carol', action: 'voter', detail: 'Added voter GHIJ...KLM' },
  { id: 'a11', timestamp: '2024-06-06T10:10:00Z', actor: 'admin.bob', action: 'claim', detail: 'Resolved claim #1061' },
  { id: 'a12', timestamp: '2024-06-06T13:25:00Z', actor: 'admin.alice', action: 'governance', detail: 'Updated quorum to 65%' },
];

const PAGE_SIZE = 5;
const ACTIONS: AuditAction[] = ['governance', 'voter', 'claim', 'auth'];

export default function AdminAuditPage() {
  const [actionFilter, setActionFilter] = useState<AuditAction | 'all'>('all');
  const [actorFilter, setActorFilter] = useState('');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const actor = actorFilter.trim().toLowerCase();
    return AUDIT_LOG.filter((entry) => {
      const matchesAction = actionFilter === 'all' || entry.action === actionFilter;
      const matchesActor = actor === '' || entry.actor.toLowerCase().includes(actor);
      return matchesAction && matchesActor;
    });
  }, [actionFilter, actorFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageEntries = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleActionChange = (value: AuditAction | 'all') => {
    setActionFilter(value);
    setPage(1);
  };

  const handleActorChange = (value: string) => {
    setActorFilter(value);
    setPage(1);
  };

  return (
    <AdminRoleGuard>
      <div className="space-y-6 p-6">
        <header>
          <h1 className="text-2xl font-semibold">Audit Log</h1>
          <p className="text-sm text-gray-500">Review administrative actions across the protocol.</p>
        </header>

        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium">Action</span>
            <select
              className="rounded border px-3 py-2"
              value={actionFilter}
              onChange={(e) => handleActionChange(e.target.value as AuditAction | 'all')}
            >
              <option value="all">All actions</option>
              {ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium">Actor</span>
            <input
              className="rounded border px-3 py-2"
              placeholder="Filter by actor"
              value={actorFilter}
              onChange={(e) => handleActorChange(e.target.value)}
            />
          </label>
        </div>

        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Timestamp</th>
                <th className="px-4 py-2 font-medium">Actor</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {pageEntries.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-gray-500" colSpan={4}>
                    No audit entries match the current filters.
                  </td>
                </tr>
              ) : (
                pageEntries.map((entry) => (
                  <tr key={entry.id} className="border-t">
                    <td className="px-4 py-2">{new Date(entry.timestamp).toLocaleString()}</td>
                    <td className="px-4 py-2">{entry.actor}</td>
                    <td className="px-4 py-2 capitalize">{entry.action}</td>
                    <td className="px-4 py-2">{entry.detail}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">
            {filtered.length} entr{filtered.length === 1 ? 'y' : 'ies'} · Page {currentPage} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border px-3 py-1 disabled:opacity-50"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1 disabled:opacity-50"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </AdminRoleGuard>
  );
}
