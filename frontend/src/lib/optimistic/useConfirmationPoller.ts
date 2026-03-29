'use client';

/**
 * useConfirmationPoller
 *
 * Polls the backend with exponential backoff until the indexer confirms a
 * pending optimistic entry, or rolls it back on timeout / error.
 *
 * Polling schedule:
 *   - Base interval : 3 s
 *   - Max interval  : 15 s  (cap — keeps UX snappy for the ~15 s window)
 *   - Timeout       : 60 s  (CONFIRMATION_TIMEOUT_MS) → triggers rollback
 */

import { useEffect, useRef } from 'react';
import { CONFIRMATION_TIMEOUT_MS } from './types';

const BASE_MS = 3_000;
const MAX_MS = 15_000;

function backoffMs(attempt: number): number {
  return Math.min(BASE_MS * Math.pow(2, attempt), MAX_MS);
}

export interface UseConfirmationPollerOptions {
  /** Unique key for the resource being polled. */
  key: string;
  /** Whether this poller should be active. */
  enabled: boolean;
  /** Epoch ms when the optimistic entry was created (for timeout). */
  createdAt: number;
  /**
   * Called each poll tick. Should return true when the indexer has confirmed
   * the expected state, false when still pending, or throw on hard error.
   */
  check: (signal: AbortSignal) => Promise<boolean>;
  onConfirmed: (key: string) => void;
  onRollback: (key: string, error: string) => void;
}

export function useConfirmationPoller({
  key,
  enabled,
  createdAt,
  check,
  onConfirmed,
  onRollback,
}: UseConfirmationPollerOptions): void {
  // Stable refs so the polling loop never captures stale closures.
  const checkRef = useRef(check);
  const onConfirmedRef = useRef(onConfirmed);
  const onRollbackRef = useRef(onRollback);

  useEffect(() => { checkRef.current = check; });
  useEffect(() => { onConfirmedRef.current = onConfirmed; });
  useEffect(() => { onRollbackRef.current = onRollback; });

  useEffect(() => {
    if (!enabled) return;

    let unmounted = false;
    let attempt = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let abortController: AbortController | null = null;

    function clearTimer() {
      if (timerId !== null) { clearTimeout(timerId); timerId = null; }
    }

    function abort() {
      abortController?.abort();
      abortController = null;
    }

    async function tick() {
      if (unmounted) return;

      // Timeout guard — roll back if we've been waiting too long.
      if (Date.now() - createdAt >= CONFIRMATION_TIMEOUT_MS) {
        onRollbackRef.current(key, 'Confirmation timed out. Please refresh to see the latest state.');
        return;
      }

      abort();
      const controller = new AbortController();
      abortController = controller;

      try {
        const confirmed = await checkRef.current(controller.signal);
        if (unmounted) return;

        if (confirmed) {
          onConfirmedRef.current(key);
          return; // done — no more polling
        }

        // Still pending — schedule next tick with backoff.
        attempt += 1;
        schedule();
      } catch (err) {
        if (unmounted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;

        // Hard error — roll back immediately.
        const msg = err instanceof Error ? err.message : 'Confirmation check failed';
        onRollbackRef.current(key, msg);
      }
    }

    function schedule() {
      clearTimer();
      timerId = setTimeout(() => { if (!unmounted) tick(); }, backoffMs(attempt));
    }

    // Kick off immediately.
    tick();

    return () => {
      unmounted = true;
      clearTimer();
      abort();
    };
    // key and createdAt identify the entry; enabled gates the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, createdAt]);
}
