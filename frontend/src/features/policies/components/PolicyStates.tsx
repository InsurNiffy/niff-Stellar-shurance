'use client';

import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonRow, SkeletonCard } from '@/components/ui/skeleton';

export function PolicyListSkeleton({ rows = 5, layout = 'row' }: { rows?: number; layout?: 'row' | 'card' }) {
  if (layout === 'card') {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-0" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} className="border-b border-gray-100" />
      ))}
    </div>
  );
}

interface PolicyEmptyStateProps {
  filter: 'active' | 'expired' | 'all';
}

export function PolicyEmptyState({ filter }: PolicyEmptyStateProps) {
  const messages: Record<typeof filter, { heading: string; body: string; cta?: boolean }> = {
    all: {
      heading: "You don't have any policies yet",
      body: "Get a quote to start your first coverage on the Stellar network.",
      cta: true,
    },
    active: {
      heading: "No active policies",
      body: "All your policies have expired, or you haven't purchased one yet.",
      cta: true,
    },
    expired: {
      heading: "No expired policies",
      body: "Your active policies will appear here once they expire.",
    },
  };

  const { heading, body, cta } = messages[filter];

  return (
    <EmptyState
      variant="policies"
      headline={heading}
      description={body}
      ctaLabel={cta ? 'Get your first quote' : undefined}
      ctaHref={cta ? '/quote' : undefined}
    />
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
