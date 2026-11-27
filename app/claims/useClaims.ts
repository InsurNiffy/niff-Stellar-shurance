'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

export type ClaimStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'paid'
  | 'expired';

export type ClaimSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Claim {
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

export interface ClaimsFilters {
  status?: ClaimStatus;
  severity?: ClaimSeverity;
  search?: string;
}

export interface ClaimsPage {
  claims: Claim[];
  nextCursor: string | null;
}

const PAGE_SIZE = 20;

async function fetchClaims(
  filters: ClaimsFilters,
  cursor: string | null,
): Promise<ClaimsPage> {
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_SIZE));
  if (cursor) params.set('cursor', cursor);
  if (filters.status) params.set('status', filters.status);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.search) params.set('search', filters.search.trim());

  const res = await fetch(`/api/claims?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to load claims (${res.status})`);
  }
  return (await res.json()) as ClaimsPage;
}

export function useClaims(filters: ClaimsFilters) {
  const query = useInfiniteQuery({
    queryKey: ['claims', filters],
    queryFn: ({ pageParam }) => fetchClaims(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const claims = useMemo(
    () => query.data?.pages.flatMap((page) => page.claims) ?? [],
    [query.data],
  );

  return {
    ...query,
    claims,
  };
}
