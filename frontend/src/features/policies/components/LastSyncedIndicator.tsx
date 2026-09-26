'use client';

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Clamp a sync timestamp so we never display a future or invalid value.
 * Returns null when the input cannot produce a trustworthy display time.
 */
export function sanitizeSyncedAt(syncedAt: number | Date | null | undefined, now = Date.now()): Date | null {
  if (syncedAt == null) return null;
  const ms = syncedAt instanceof Date ? syncedAt.getTime() : syncedAt;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  // Cap at "now" so clock skew never shows a future time.
  return new Date(Math.min(ms, now));
}

/** Human-readable relative label for a last-synced instant. */
export function formatLastSynced(syncedAt: Date, now = Date.now()): string {
  const diffMs = Math.max(0, now - syncedAt.getTime());
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export interface LastSyncedIndicatorProps {
  /** Epoch ms or Date of the last successful data sync. */
  syncedAt: number | Date | null | undefined;
  /** Force a refresh of policy data. */
  onRefresh: () => void;
  /** True while a refresh is in flight. */
  isRefreshing?: boolean;
  className?: string;
}

/**
 * Shows when policy data was last refreshed, with a manual refresh control.
 */
export function LastSyncedIndicator({
  syncedAt,
  onRefresh,
  isRefreshing = false,
  className,
}: LastSyncedIndicatorProps) {
  const safe = sanitizeSyncedAt(syncedAt);
  const label = safe ? formatLastSynced(safe) : 'never';
  const absolute = safe
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(safe)
    : undefined;

  return (
    <div
      className={cn(
        'flex items-center gap-2 text-xs text-muted-foreground',
        className,
      )}
      data-testid="last-synced-indicator"
    >
      <span aria-live="polite" title={absolute}>
        Last synced: {label}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 min-h-8 px-2"
        onClick={onRefresh}
        disabled={isRefreshing}
        aria-label="Refresh policy data"
      >
        <RefreshCw
          className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')}
          aria-hidden="true"
        />
        <span className="ml-1">Refresh</span>
      </Button>
    </div>
  );
}
