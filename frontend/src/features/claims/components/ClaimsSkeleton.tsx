'use client';

import { Skeleton, SkeletonRow, SkeletonDetail } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const DEFAULT_LIST_ROWS = 5;

/**
 * Shared list skeleton matching the claims table / board row layout.
 * Use while claims list data is fetching so list and detail views share one pattern.
 */
export function ClaimsListSkeleton({
  rows = DEFAULT_LIST_ROWS,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label="Loading claims"
      aria-busy="true"
      className={cn('flex flex-col gap-0', className)}
      data-testid="claims-list-skeleton"
    >
      <span className="sr-only">Loading claims…</span>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} className="border-b border-gray-100 min-h-[52px]" />
      ))}
    </div>
  );
}

/**
 * Shared detail skeleton matching claim detail card layout.
 * Sized to approximate real content and avoid layout jump when data arrives.
 */
export function ClaimsDetailSkeleton({ className }: { className?: string }) {
  return (
    <section
      role="status"
      aria-label="Loading claim details"
      aria-busy="true"
      className={cn('space-y-6', className)}
      data-testid="claims-detail-skeleton"
    >
      <span className="sr-only">Loading claim details…</span>
      {Array.from({ length: 3 }, (_, i) => (
        <div
          key={i}
          className="rounded-lg border bg-card p-6 space-y-4"
          aria-hidden="true"
        >
          <Skeleton className="h-6 w-1/3" />
          <SkeletonDetail />
          <Skeleton className="h-44 w-full" />
        </div>
      ))}
    </section>
  );
}
