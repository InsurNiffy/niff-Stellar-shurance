'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'paid';
export type ClaimSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Claim {
  id: string;
  policyId: string;
  policyType: string;
  amount: number;
  status: ClaimStatus;
  severity: ClaimSeverity;
  votesFor: number;
  votesAgainst: number;
  quorum: number;
  deadline: string;
}

export interface ClaimsFilters {
  status?: ClaimStatus;
  severity?: ClaimSeverity;
  search?: string;
}

export interface ClaimsPage {
  claims: Claim[];
  nextCursor: string | null;
}

const PAGE_SIZE = 10;

async function fetchClaims(
  filters: ClaimsFilters,
  cursor: string | null,
): Promise<ClaimsPage> {
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_SIZE));
  if (cursor) params.set('cursor', cursor);
  if (filters.status) params.set('status', filters.status);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.search) params.set('search', filters.search);

  const res = await fetch(`/api/claims?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to load claims');
  return (await res.json()) as ClaimsPage;
}

export function useClaims(filters: ClaimsFilters) {
  const [cursor, setCursor] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['claims', filters, cursor],
    queryFn: () => fetchClaims(filters, cursor),
  });

  return {
    ...query,
    nextCursor: query.data?.nextCursor ?? null,
    goNext: () => {
      if (query.data?.nextCursor) setCursor(query.data.nextCursor);
    },
    goPrev: () => setCursor(null),
    resetCursor: () => setCursor(null),
  };
}

const STATUS_VARIANTS: Record<ClaimStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  paid: 'bg-blue-100 text-blue-800',
};

function quorumPercent(claim: Claim): number {
  if (claim.quorum <= 0) return 0;
  const total = claim.votesFor + claim.votesAgainst;
  return Math.min(100, Math.round((total / claim.quorum) * 100));
}

function formatCountdown(deadline: string): string {
  const diff = new Date(deadline).getTime() - Date.now();
  if (Number.isNaN(diff)) return '—';
  if (diff <= 0) return 'Expired';
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

export function ClaimsBoard() {
  const [status, setStatus] = useState<ClaimStatus | 'all'>('all');
  const [severity, setSeverity] = useState<ClaimSeverity | 'all'>('all');
  const [search, setSearch] = useState('');

  const filters = useMemo<ClaimsFilters>(
    () => ({
      status: status === 'all' ? undefined : status,
      severity: severity === 'all' ? undefined : severity,
      search: search.trim() || undefined,
    }),
    [status, severity, search],
  );

  const { data, isLoading, isError, nextCursor, goNext, goPrev, resetCursor } =
    useClaims(filters);

  const claims = data?.claims ?? [];

  const handleFilterChange = (fn: () => void) => {
    fn();
    resetCursor();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Search by claim ID or policy ID"
          value={search}
          onChange={(e) => handleFilterChange(() => setSearch(e.target.value))}
          className="sm:max-w-xs"
        />
        <Select
          value={status}
          onValueChange={(v) =>
            handleFilterChange(() => setStatus(v as ClaimStatus | 'all'))
          }
        >
          <SelectTrigger className="sm:w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={severity}
          onValueChange={(v) =>
            handleFilterChange(() => setSeverity(v as ClaimSeverity | 'all'))
          }
        >
          <SelectTrigger className="sm:w-40">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isError ? (
        <div className="rounded-md border border-destructive/40 p-6 text-center text-sm text-destructive">
          Failed to load claims. Please try again.
        </div>
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : claims.length === 0 ? (
        <div className="rounded-md border p-10 text-center text-sm text-muted-foreground">
          No claims match the current filters.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Claim ID</TableHead>
              <TableHead>Policy type</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Quorum</TableHead>
              <TableHead>Deadline</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {claims.map((claim) => (
              <TableRow key={claim.id}>
                <TableCell className="font-mono text-xs">{claim.id}</TableCell>
                <TableCell>{claim.policyType}</TableCell>
                <TableCell>{claim.amount.toLocaleString()}</TableCell>
                <TableCell>
                  <Badge className={STATUS_VARIANTS[claim.status]}>
                    {claim.status}
                  </Badge>
                </TableCell>
                <TableCell className="min-w-[120px]">
                  <Progress value={quorumPercent(claim)} />
                  <span className="text-xs text-muted-foreground">
                    {claim.votesFor + claim.votesAgainst}/{claim.quorum}
                  </span>
                </TableCell>
                <TableCell>{formatCountdown(claim.deadline)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={goPrev} disabled={isLoading}>
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={goNext}
          disabled={isLoading || !nextCursor}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export default ClaimsBoard;
