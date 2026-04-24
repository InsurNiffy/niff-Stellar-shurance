"use client";

import { useNetworkAwareQuery, STALE_TIMES } from '@/lib/query';
import { z } from "zod";

import type { ClaimFilters } from "@/components/claims/types";
import { FILTER_QUERY_PARAMS } from "@/components/claims/types";
import { ClaimBoardSchema } from "@/lib/schemas/claims-board";
import type { ClaimBoard } from "@/lib/schemas/claims-board";

// ---------------------------------------------------------------------------
// Zod schema for the paginated API response (Requirements 1.2)
// ---------------------------------------------------------------------------

const ClaimsPageSchema = z.object({
  claims: z.array(ClaimBoardSchema),
  page: z.number(),
  totalPages: z.number(),
  totalCount: z.number(),
});

// ---------------------------------------------------------------------------
// Query param builder
// ---------------------------------------------------------------------------

function buildQueryParams(
  filters: ClaimFilters,
  page: number,
): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.status !== "all") {
    params.set(FILTER_QUERY_PARAMS.status, filters.status);
  }

  if (filters.policyRef) {
    params.set(FILTER_QUERY_PARAMS.policyRef, filters.policyRef);
  }

  if (filters.submittedAfter) {
    params.set(FILTER_QUERY_PARAMS.submittedAfter, filters.submittedAfter);
  }

  if (filters.submittedBefore) {
    params.set(FILTER_QUERY_PARAMS.submittedBefore, filters.submittedBefore);
  }

  // needsMyVote is only sent when true (omit when false — Req 4.1)
  if (filters.needsMyVote) {
    params.set(FILTER_QUERY_PARAMS.needsMyVote, "1");
  }

  params.set(FILTER_QUERY_PARAMS.page, String(page));

  return params;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseClaimsDataReturn {
  claims: ClaimBoard[];
  totalPages: number;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * Fetches a paginated, filtered list of claims from GET /api/claims.
 * Validates the response with Zod. Cancels in-flight requests via
 * AbortController on unmount or when filters/page change (Req 6.4).
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 6.4
 */
export function useClaimsData(
  filters: ClaimFilters,
  page: number,
): UseClaimsDataReturn {
  const [claims, setClaims] = useState<ClaimBoard[]>([]);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // retryCount is incremented by retry() to re-trigger the effect.
  const [retryCount, setRetryCount] = useState<number>(0);

  // Keep a ref to the current AbortController so we can abort on cleanup.
  const abortControllerRef = useRef<AbortController | null>(null);

  const retry = useCallback(() => {
    setRetryCount((c) => c + 1);
  }, []);

  useEffect(() => {
    // Abort any previous in-flight request before starting a new one.
    abortControllerRef.current?.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let cancelled = false;

    async function fetchClaims() {
      setLoading(true);
      setError(null);

      try {
        const params = buildQueryParams(filters, page);
        const response = await fetch(`/api/claims?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(
            `Failed to fetch claims: ${response.status} ${response.statusText}`,
          );
        }

        const json: unknown = await response.json();
        const parsed = ClaimsPageSchema.safeParse(json);

        if (!parsed.success) {
          throw new Error(
            `Invalid response from server: ${parsed.error.message}`,
          );
        }

        if (!cancelled) {
          setClaims(parsed.data.claims);
          setTotalPages(parsed.data.totalPages);
        }
      } catch (err) {
        if (cancelled) return;

        // AbortError is expected on cleanup — don't surface it as an error.
        if (err instanceof DOMException && err.name === "AbortError") return;

        const message =
          err instanceof Error ? err.message : "An unexpected error occurred";
        setError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchClaims();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // retryCount is intentionally included so retry() re-triggers the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page, retryCount]);

  return { claims, totalPages, loading, error, retry };
}
