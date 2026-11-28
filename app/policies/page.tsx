'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export type PolicyStatus = 'Active' | 'Expired' | 'Terminated';

export interface Policy {
  id: string;
  policyType: string;
  coverageAmount: number;
  expiresAt: string;
  status: PolicyStatus;
}

interface PolicyPage {
  items: Policy[];
  nextCursor: string | null;
}

const PAGE_SIZE = 10;
const STATUS_FILTERS: Array<PolicyStatus | 'All'> = ['All', 'Active', 'Expired', 'Terminated'];

async function fetchPolicies({
  cursor,
  status,
}: {
  cursor: string | null;
  status: PolicyStatus | 'All';
}): Promise<PolicyPage> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) params.set('cursor', cursor);
  if (status !== 'All') params.set('status', status);

  const res = await fetch(`/api/policies?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to load policies');
  return (await res.json()) as PolicyPage;
}

export function usePolicies(status: PolicyStatus | 'All') {
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: ['policies', status],
    queryFn: ({ pageParam }) => fetchPolicies({ cursor: pageParam, status }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const updatePolicy = useCallback(
    (id: string, patch: Partial<Policy>) => {
      queryClient.setQueryData<{ pages: PolicyPage[]; pageParams: unknown[] }>(
        ['policies', status],
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            pages: prev.pages.map((page) => ({
              ...page,
              items: page.items.map((p) => (p.id === id ? { ...p, ...patch } : p)),
            })),
          };
        },
      );
    },
    [queryClient, status],
  );

  return { ...query, updatePolicy };
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

function useCountdown(expiresAt: string): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return useMemo(() => {
    const diff = new Date(expiresAt).getTime() - now;
    if (diff <= 0) return 'Expired';
    const days = Math.floor(diff / 86_400_000);
    const hours = Math.floor((diff % 86_400_000) / 3_600_000);
    const minutes = Math.floor((diff % 3_600_000) / 60_000);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }, [expiresAt, now]);
}

const STATUS_STYLES: Record<PolicyStatus, string> = {
  Active: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  Expired: 'bg-amber-100 text-amber-800 border-amber-200',
  Terminated: 'bg-rose-100 text-rose-800 border-rose-200',
};

function StatusBadge({ status }: { status: PolicyStatus }) {
  return (
    <Badge variant="outline" className={cn('capitalize', STATUS_STYLES[status])}>
      {status}
    </Badge>
  );
}

function PolicyRow({ policy }: { policy: Policy }) {
  const countdown = useCountdown(policy.expiresAt);

  return (
    <li className="flex flex-col gap-2 border-b px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <span className="font-medium">{policy.policyType}</span>
        <span className="text-sm text-muted-foreground">
          Coverage {formatCurrency(policy.coverageAmount)}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">
          {policy.status === 'Active' ? `Expires in ${countdown}` : countdown}
        </span>
        <StatusBadge status={policy.status} />
      </div>
    </li>
  );
}

function PolicyListSkeleton() {
  return (
    <ul className="divide-y rounded-lg border">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="flex items-center justify-between px-4 py-3">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="flex items-center gap-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function PolicyDashboard() {
  const [status, setStatus] = useState<PolicyStatus | 'All'>('All');
  const { data, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage } =
    usePolicies(status);

  const policies = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data],
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">My Policies</h1>
        <p className="text-sm text-muted-foreground">
          Track coverage, expiry, and status of your policies.
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={status === option ? 'default' : 'outline'}
            aria-pressed={status === option}
            onClick={() => setStatus(option)}
          >
            {option}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <PolicyListSkeleton />
      ) : isError ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Unable to load policies. Please try again later.
        </div>
      ) : policies.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">No policies found</p>
          <p className="text-sm text-muted-foreground">
            {status === 'All'
              ? 'You have no policies yet.'
              : `You have no ${status.toLowerCase()} policies.`}
          </p>
        </div>
      ) : (
        <>
          <ul className="divide-y rounded-lg border">
            {policies.map((policy) => (
              <PolicyRow key={policy.id} policy={policy} />
            ))}
          </ul>
          {hasNextPage && (
            <Button
              variant="outline"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export default function PoliciesPage() {
  return <PolicyDashboard />;
}
