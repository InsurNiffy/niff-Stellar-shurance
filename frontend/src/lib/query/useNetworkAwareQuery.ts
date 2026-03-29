'use client';

/**
 * useNetworkAwareQuery
 *
 * Thin wrapper around useQuery that pauses background refetch when the
 * browser is offline. React Query's built-in networkMode handles fetch
 * suspension, but this hook also wires the Page Visibility API to stop
 * interval-based refetch on hidden tabs — avoiding battery drain on mobile.
 *
 * Usage:
 *   const { data, isLoading } = useNetworkAwareQuery({
 *     queryKey: ['policies', holder],
 *     queryFn: () => fetchPolicies(holder),
 *     staleTime: STALE_TIMES.policies,
 *     // Enable window-focus refetch only for time-sensitive queries:
 *     refetchOnWindowFocus: false,
 *   });
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { UseQueryOptions, UseQueryResult, QueryKey } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Online state hook — subscribes to navigator.onLine + online/offline events.
// ---------------------------------------------------------------------------

function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    function handleOnline() { setIsOnline(true); }
    function handleOffline() { setIsOnline(false); }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

// ---------------------------------------------------------------------------
// Visibility state hook — returns true when the tab is visible.
// ---------------------------------------------------------------------------

function useIsVisible(): boolean {
  const [isVisible, setIsVisible] = useState(
    typeof document !== 'undefined'
      ? document.visibilityState === 'visible'
      : true,
  );

  useEffect(() => {
    function handleVisibility() {
      setIsVisible(document.visibilityState === 'visible');
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  return isVisible;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type NetworkAwareQueryOptions<
  TData,
  TError,
  TQueryKey extends QueryKey,
> = UseQueryOptions<TData, TError, TData, TQueryKey>;

export function useNetworkAwareQuery<
  TData = unknown,
  TError = Error,
  TQueryKey extends QueryKey = QueryKey,
>(
  options: NetworkAwareQueryOptions<TData, TError, TQueryKey>,
): UseQueryResult<TData, TError> {
  const isOnline = useIsOnline();
  const isVisible = useIsVisible();

  // Pause interval-based background refetch when offline or tab is hidden.
  const shouldPauseRefetch = !isOnline || !isVisible;

  // Resolve refetchInterval: pause when offline/hidden, otherwise use caller value.
  const callerInterval = options.refetchInterval;
  const resolvedInterval = shouldPauseRefetch ? false : callerInterval;

  return useQuery<TData, TError, TData, TQueryKey>({
    ...options,
    // networkMode: 'offlineFirst' lets React Query serve cached data offline
    // without immediately marking queries as errored.
    networkMode: 'offlineFirst',
    refetchInterval: resolvedInterval,
    // Disable window-focus refetch when offline regardless of caller setting.
    refetchOnWindowFocus: isOnline ? (options.refetchOnWindowFocus ?? false) : false,
  });
}
