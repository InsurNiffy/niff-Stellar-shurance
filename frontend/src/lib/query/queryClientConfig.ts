/**
 * Centralized React Query configuration for NiffyInsur.
 *
 * Rationale
 * ---------
 * Default React Query settings (staleTime: 0, retry: 3 with fixed backoff)
 * are poorly suited to a blockchain-backed app where:
 *   - On-chain data changes infrequently (new ledger every ~5 s, indexer lags ~15 s).
 *   - RPC/indexer errors are transient — aggressive retries waste bandwidth.
 *   - 4xx errors (bad request, unauthorized) are never transient and must not retry.
 *   - Background refetch on a hidden tab drains mobile battery.
 *
 * Stale times (per query type)
 * ----------------------------
 *   policies   30 s  — policy state changes only on user action (renew/terminate)
 *   claims     10 s  — claims can be filed by any holder; moderate freshness needed
 *   votes       5 s  — active voting windows are time-sensitive
 *   ledger      5 s  — latest ledger advances every ~5 s
 *   default    15 s  — catch-all for uncategorized queries
 *
 * Retry policy
 * ------------
 *   - Max 3 attempts for transient errors (network, 5xx, 429).
 *   - No retry for 4xx client errors (except 429 Retry-After).
 *   - Exponential backoff: 1 s → 2 s → 4 s (capped at 30 s).
 *
 * Background refetch
 * ------------------
 *   - refetchOnWindowFocus: false globally; enabled per-query only for votes.
 *   - refetchOnReconnect: true — always resync after coming back online.
 *   - refetchIntervalInBackground: false — respects Page Visibility API.
 */

import { QueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Stale time constants — import these in useQuery calls for consistency.
// ---------------------------------------------------------------------------

export const STALE_TIMES = {
  /** Policy list / detail — changes only on user-initiated transactions. */
  policies: 30_000,
  /** Claims list — any holder can file; moderate freshness. */
  claims: 10_000,
  /** Vote tallies — time-sensitive during open voting windows. */
  votes: 5_000,
  /** Latest ledger sequence — advances every ~5 s. */
  ledger: 5_000,
  /** Default catch-all. */
  default: 15_000,
} as const;

// ---------------------------------------------------------------------------
// Retry predicate — never retry 4xx (except 429).
// ---------------------------------------------------------------------------

interface MaybeHttpError {
  status?: number;
}

function isNonRetryable(error: unknown): boolean {
  const status = (error as MaybeHttpError)?.status;
  if (typeof status !== 'number') return false;
  // 4xx except 429 (rate limit) are client errors — retrying won't help.
  return status >= 400 && status < 500 && status !== 429;
}

function retryDelay(attempt: number): number {
  // Exponential backoff: 1s, 2s, 4s — capped at 30s.
  return Math.min(1_000 * Math.pow(2, attempt), 30_000);
}

// ---------------------------------------------------------------------------
// QueryClient factory — call once at app root.
// ---------------------------------------------------------------------------

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIMES.default,
        // 3 retries for transient errors; skip for 4xx.
        retry: (failureCount: number, error: unknown) => {
          if (isNonRetryable(error)) return false;
          return failureCount < 3;
        },
        retryDelay: (attempt: number) => retryDelay(attempt),
        // Disable window-focus refetch globally; enable per-query for votes.
        refetchOnWindowFocus: false,
        // Always resync after reconnect.
        refetchOnReconnect: true,
        // Never refetch in a background tab — respects Page Visibility API.
        refetchIntervalInBackground: false,
      },
      mutations: {
        retry: (failureCount: number, error: unknown) => {
          if (isNonRetryable(error)) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt: number) => retryDelay(attempt),
      },
    },
  });
}
