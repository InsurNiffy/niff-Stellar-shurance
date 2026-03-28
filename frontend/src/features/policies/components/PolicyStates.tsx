'use client';

import { Skeleton } from '@/components/ui/skeleton';

export function PolicyListSkeleton({ rows = 5, layout = 'row' }: { rows?: number; layout?: 'row' | 'card' }) {
  if (layout === 'card') {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="rounded-lg border border-gray-200 p-4 space-y-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-3 border-b border-gray-100">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-14" />
          <Skeleton className="h-5 w-24 ml-auto" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-9 w-32" />
        </div>
      ))}
    </div>
  );
}

interface EmptyStateProps {
  filter: 'active' | 'expired' | 'all';
}

export function PolicyEmptyState({ filter }: EmptyStateProps) {
  const messages: Record<typeof filter, { heading: string; body: string }> = {
    all: {
      heading: "You don't have any policies yet",
      body: "Get a quote to start your first coverage on the Stellar network.",
    },
    active: {
      heading: "No active policies",
      body: "All your policies have expired, or you haven't purchased one yet.",
    },
    expired: {
      heading: "No expired policies",
      body: "Your active policies will appear here once they expire.",
    },
  };

  const { heading, body } = messages[filter];

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <span className="text-4xl" aria-hidden="true">📋</span>
      <h2 className="text-lg font-semibold text-gray-900">{heading}</h2>
      <p className="text-sm text-gray-500 max-w-xs">{body}</p>
      {filter !== 'expired' && (
        <a
          href="/quote"
          className="mt-2 inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
        >
          Get a quote
        </a>
      )}
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function PolicyErrorState({ message, onRetry }: ErrorStateProps) {
  const isWalletError = message === 'wallet_not_connected';

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <span className="text-4xl" aria-hidden="true">⚠️</span>
      <h2 className="text-lg font-semibold text-gray-900">
        {isWalletError ? 'Wallet not connected' : 'Failed to load policies'}
      </h2>
      <p className="text-sm text-gray-500 max-w-xs">
        {isWalletError
          ? 'Connect your Stellar wallet to view your policies.'
          : message}
      </p>
      {!isWalletError && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
        >
          Try again
        </button>
      )}
    </div>
  );
}
