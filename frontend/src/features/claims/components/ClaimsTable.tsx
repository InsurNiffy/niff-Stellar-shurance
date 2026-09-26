'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import type { ClaimBoard } from '@/lib/schemas/claims-board';
import type { ClaimSortField, ClaimSortDir } from '../api';
import { ClaimsListSkeleton } from './ClaimsSkeleton';

const STATUS_CONFIG: Record<string, { label: string; shape: string; className: string }> = {
  Processing: { label: 'Processing', shape: '◐', className: 'bg-yellow-100 text-yellow-900' },
  Pending: { label: 'Pending', shape: '○', className: 'bg-gray-100 text-gray-800' },
  Approved: { label: 'Approved', shape: '●', className: 'bg-green-100 text-green-900' },
  Paid: { label: 'Paid', shape: '★', className: 'bg-blue-100 text-blue-900' },
  Rejected: { label: 'Rejected', shape: '✕', className: 'bg-red-100 text-red-900' },
  Withdrawn: { label: 'Withdrawn', shape: '↩', className: 'bg-slate-100 text-slate-800' },
};

const COLUMNS: { key: ClaimSortField | 'claim_id' | 'policy_id'; label: string; sortable?: boolean }[] = [
  { key: 'claim_id', label: 'Claim ID' },
  { key: 'policy_id', label: 'Policy' },
  { key: 'filed_at', label: 'Filed', sortable: true },
  { key: 'quorum', label: 'Quorum', sortable: true },
  { key: 'deadline', label: 'Deadline', sortable: true },
  { key: 'claim_id', label: 'Status' },
];

export interface ClaimsTableProps {
  claims: ClaimBoard[];
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  total: number;
  pageIndex: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  sort: ClaimSortField;
  sortDir: ClaimSortDir;
  onSort: (field: ClaimSortField) => void;
  onNextPage: () => void;
  onPrevPage: () => void;
  onRefetch: () => void;
}

export function ClaimsTable({
  claims,
  isLoading,
  isFetching,
  error,
  total,
  pageIndex,
  hasNextPage,
  hasPrevPage,
  sort,
  sortDir,
  onSort,
  onNextPage,
  onPrevPage,
  onRefetch,
}: ClaimsTableProps) {
  if (error) {
    return (
      <EmptyState
        variant="claims"
        headline="Failed to load claims"
        description={error}
        secondaryLabel="Try again"
        onSecondaryClick={onRefetch}
      />
    );
  }

  const showSkeleton = isLoading;
  const showEmpty = !isLoading && claims.length === 0;

  return (
    <div className="space-y-4">
      <div
        aria-live="polite"
        aria-busy={isFetching}
        className={isFetching && !isLoading ? 'opacity-60 transition-opacity' : undefined}
      >
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((col, i) => (
                <TableHead key={`${col.key}-${i}`}>
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.key as ClaimSortField)}
                      className="flex items-center gap-1 font-medium hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring rounded"
                      aria-label={`Sort by ${col.label}${sort === col.key ? `, currently ${sortDir}` : ''}`}
                    >
                      {col.label}
                      {sort === col.key && (
                        <span aria-hidden="true">{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {showSkeleton
              ? (
                  <TableRow>
                    <TableCell colSpan={COLUMNS.length} className="p-0">
                      <ClaimsListSkeleton />
                    </TableCell>
                  </TableRow>
                )
              : claims.map((claim) => {
                  const cfg = STATUS_CONFIG[claim.status] ?? {
                    label: claim.status,
                    shape: '?',
                    className: 'bg-gray-100 text-gray-800',
                  };
                  return (
                    <TableRow key={claim.claim_id}>
                      <TableCell className="font-mono text-sm">{claim.claim_id}</TableCell>
                      <TableCell className="text-sm">{claim.policy_id}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(claim.filed_at * 1000).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm">
                        {claim.approve_votes + claim.reject_votes}
                        {claim.quorum_threshold != null && ` / ${claim.quorum_threshold}`}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {claim.deadline_timestamp
                          ? new Date(claim.deadline_timestamp).toLocaleDateString()
                          : `Ledger ${claim.voting_deadline_ledger}`}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}
                          aria-label={`Status: ${cfg.label}`}
                        >
                          <span aria-hidden="true">{cfg.shape}</span>
                          {cfg.label}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
          </TableBody>
        </Table>

        {showEmpty && (
          <EmptyState
            variant="claims"
            headline="No claims found"
            description="Try adjusting your filters."
          />
        )}
      </div>

      {!showSkeleton && (total > 0 || hasPrevPage) && (
        <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
          <span>{total > 0 ? `${total} claim${total !== 1 ? 's' : ''}` : ''}</span>
          <Pagination
            hasMore={hasNextPage}
            onNext={onNextPage}
            onPrev={onPrevPage}
            pageSize={25}
            onPageSizeChange={() => undefined}
            page={pageIndex + 1}
          />
        </div>
      )}
    </div>
  );
}
