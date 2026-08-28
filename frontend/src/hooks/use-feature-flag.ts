'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/fetch';
import { getConfig } from '@/config/env';

interface FeatureFlagResponse {
  key: string;
  enabled: boolean;
}

async function fetchFeatureFlag(flagKey: string): Promise<boolean> {
  const { apiUrl } = getConfig();
  const data = await apiFetch<FeatureFlagResponse>(`${apiUrl}/api/feature-flags/${flagKey}`);
  return data.enabled;
}

export interface UseFeatureFlagResult {
  enabled: boolean;
  loading: boolean;
}

export function useFeatureFlag(flagKey: string): UseFeatureFlagResult {
  const { data, isLoading } = useQuery({
    queryKey: ['feature-flag', flagKey],
    queryFn: () => fetchFeatureFlag(flagKey),
    staleTime: 60_000,
  });

  return {
    enabled: data ?? false,
    loading: isLoading,
  };
}
