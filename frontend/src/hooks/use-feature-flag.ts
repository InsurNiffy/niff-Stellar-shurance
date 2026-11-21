'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/fetch';
import { getConfig } from '@/config/env';
import { isKnownFeatureFlag } from '@/config/features';

interface FeatureFlagResponse {
  key: string;
  enabled: boolean;
}

const STALE_TIME_MS = 60_000;

async function fetchFeatureFlag(flagKey: string): Promise<boolean> {
  const { apiUrl } = getConfig();
  const data = await apiFetch<FeatureFlagResponse>(
    `${apiUrl}/api/feature-flags/${encodeURIComponent(flagKey)}`,
  );
  return data?.enabled === true;
}

/**
 * Returns true only when a documented backend flag is explicitly enabled.
 * Unknown keys and network/API errors fail closed (false).
 */
export function useFeatureFlag(key: string): boolean {
  const { data } = useFeatureFlagState(key);
  return data === true;
}

/** Stateful variant for callers that also need the query's loading status. */
export function useFeatureFlagState(flagKey: string): UseFeatureFlagResult {
  const knownFlag = isKnownFeatureFlag(flagKey);

  const { data, isLoading } = useQuery({
    queryKey: ['feature-flag', flagKey],
    queryFn: () => fetchFeatureFlag(flagKey),
    staleTime: STALE_TIME_MS,
    // Unknown keys and network failures must gate the UI off, never throw.
    enabled: knownFlag,
    retry: false,
  });

  return {
    enabled: knownFlag && data === true,
    loading: knownFlag && isLoading,
  };
}

export interface UseFeatureFlagResult {
  enabled: boolean;
  loading: boolean;
}
