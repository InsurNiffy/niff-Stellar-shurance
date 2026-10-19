"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type NetworkStatus = "healthy" | "degraded" | "offline";

export interface NetworkStatusState {
  status: NetworkStatus;
  chainInfo: unknown | null;
  health: unknown | null;
  lastChecked: number | null;
  error: string | null;
  bannerDismissed: boolean;
  dismissBanner: () => void;
  refresh: () => void;
}

const POLL_INTERVAL_MS = 30_000;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`${url} responded with ${res.status}`);
  }
  return res.json();
}

function deriveStatus(
  chainOk: boolean,
  healthOk: boolean,
): NetworkStatus {
  if (!chainOk && !healthOk) return "offline";
  if (!chainOk || !healthOk) return "degraded";
  return "healthy";
}

export function useNetworkStatus(): NetworkStatusState {
  const [status, setStatus] = useState<NetworkStatus>("healthy");
  const [chainInfo, setChainInfo] = useState<unknown | null>(null);
  const [health, setHealth] = useState<unknown | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const mountedRef = useRef(true);

  const check = useCallback(async () => {
    const [chainResult, healthResult] = await Promise.allSettled([
      fetchJson("/api/chain/info"),
      fetchJson("/api/health"),
    ]);

    if (!mountedRef.current) return;

    const chainOk = chainResult.status === "fulfilled";
    const healthOk = healthResult.status === "fulfilled";

    setChainInfo(chainOk ? chainResult.value : null);
    setHealth(healthOk ? healthResult.value : null);
    setStatus(deriveStatus(chainOk, healthOk));
    setLastChecked(Date.now());

    if (!chainOk && !healthOk) {
      setError("Unable to reach Stellar network endpoints");
    } else if (!chainOk || !healthOk) {
      setError("One or more Stellar network endpoints are degraded");
    } else {
      setError(null);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void check();
    const interval = setInterval(() => {
      void check();
    }, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [check]);

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true);
  }, []);

  const refresh = useCallback(() => {
    setBannerDismissed(false);
    void check();
  }, [check]);

  return {
    status,
    chainInfo,
    health,
    lastChecked,
    error,
    bannerDismissed,
    dismissBanner,
    refresh,
  };
}

export default useNetworkStatus;
