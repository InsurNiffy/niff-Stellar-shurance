"use client";

// Feature: claim-status-notifications
// Requirements: polling with exponential backoff, Page Visibility API pause,
//               battery-conscious on mobile, mute/snooze per claim

import { useEffect, useRef, useCallback } from "react";
import { z } from "zod";
import { calcBackoffMs } from "./useRealtimeTallies";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const ClaimStatusUpdateSchema = z.object({
  claimId: z.string(),
  status: z.string(),
  updatedAt: z.string(),
});

export type ClaimStatusUpdate = z.infer<typeof ClaimStatusUpdateSchema>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base polling interval when watching specific claims (ms). */
const BASE_MS = 15_000;
/** Hard cap so we never poll more than once per minute when backing off. */
const MAX_MS = 60_000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseClaimWatcherOptions {
  /** Claim IDs to watch. Polling is skipped when empty. */
  claimIds: string[];
  /** Called for each status change detected. */
  onStatusChange: (update: ClaimStatusUpdate) => void;
  /** Set to false to fully disable polling (e.g. feature flag off). */
  enabled?: boolean;
}

/**
 * Polls /api/claims/status for watched claim IDs.
 *
 * - Exponential backoff on consecutive failures (base 15 s, cap 60 s).
 * - Pauses when document.visibilityState === "hidden" (Page Visibility API)
 *   to reduce battery drain on mobile.
 * - Resumes immediately when the tab becomes visible again.
 * - Cleans up all timers and abort controllers on unmount.
 */
export function useClaimWatcher({
  claimIds,
  onStatusChange,
  enabled = true,
}: UseClaimWatcherOptions): void {
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  });

  const claimIdsRef = useRef(claimIds);
  useEffect(() => {
    claimIdsRef.current = claimIds;
  });

  // Track last-known statuses so we only fire onStatusChange for actual changes.
  const lastStatusRef = useRef<Map<string, string>>(new Map());

  const poll = useCallback(async (
    signal: AbortSignal,
  ): Promise<void> => {
    const ids = claimIdsRef.current;
    if (ids.length === 0) return;

    const params = new URLSearchParams();
    ids.forEach((id) => params.append("claimId", id));

    const res = await fetch(`/api/claims/status?${params.toString()}`, {
      signal,
      // Avoid caching so we always get fresh data.
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const updates = (await res.json()) as unknown[];
    for (const raw of updates) {
      const parsed = ClaimStatusUpdateSchema.safeParse(raw);
      if (!parsed.success) continue;
      const { claimId, status } = parsed.data;
      if (lastStatusRef.current.get(claimId) !== status) {
        lastStatusRef.current.set(claimId, status);
        onStatusChangeRef.current(parsed.data);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let unmounted = false;
    let failureCount = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let abortController: AbortController | null = null;

    function clearTimer() {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    }

    function abortPoll() {
      abortController?.abort();
      abortController = null;
    }

    async function runPoll() {
      if (unmounted) return;
      if (document.visibilityState === "hidden") return; // battery-conscious pause

      abortPoll();
      const controller = new AbortController();
      abortController = controller;

      try {
        await poll(controller.signal);
        if (!unmounted) {
          failureCount = 0;
          schedule(false);
        }
      } catch (err) {
        if (unmounted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        failureCount += 1;
        schedule(true);
      }
    }

    function schedule(isFailure: boolean) {
      if (unmounted) return;
      clearTimer();
      const delay = isFailure
        ? calcBackoffMs(failureCount, BASE_MS, MAX_MS)
        : BASE_MS;
      timerId = setTimeout(() => {
        if (!unmounted) runPoll();
      }, delay);
    }

    function handleVisibilityChange() {
      if (unmounted) return;
      if (document.visibilityState === "visible") {
        clearTimer();
        runPoll(); // immediate poll on tab focus
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    runPoll(); // initial poll on mount

    return () => {
      unmounted = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearTimer();
      abortPoll();
    };
  }, [enabled, poll]);
}
