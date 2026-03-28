'use client';

/**
 * useOptimisticState
 *
 * Generic hook that manages a map of optimistic entries keyed by resource ID.
 * Provides helpers to apply, confirm, and roll back optimistic updates.
 *
 * State is intentionally held in React state (not localStorage / sessionStorage)
 * so it never persists across page reloads — the server is always the source of
 * truth on mount.
 */

import { useCallback, useReducer } from 'react';
import type { OptimisticEntry, OptimisticOperationType } from './types';

// ---------------------------------------------------------------------------
// State & reducer
// ---------------------------------------------------------------------------

type OptimisticMap<T> = Map<string, OptimisticEntry<T>>;

type Action<T> =
  | { type: 'APPLY'; entry: OptimisticEntry<T> }
  | { type: 'CONFIRM'; key: string }
  | { type: 'ROLLBACK'; key: string; error: string }
  | { type: 'REMOVE'; key: string };

function reducer<T>(state: OptimisticMap<T>, action: Action<T>): OptimisticMap<T> {
  const next = new Map(state);
  switch (action.type) {
    case 'APPLY':
      next.set(action.entry.key, action.entry);
      return next;
    case 'CONFIRM': {
      const entry = next.get(action.key);
      if (!entry) return state;
      next.set(action.key, { ...entry, status: 'confirmed' });
      return next;
    }
    case 'ROLLBACK': {
      const entry = next.get(action.key);
      if (!entry) return state;
      next.set(action.key, { ...entry, status: 'failed', error: action.error });
      return next;
    }
    case 'REMOVE':
      next.delete(action.key);
      return next;
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseOptimisticStateReturn<T> {
  /** All current optimistic entries. */
  entries: OptimisticMap<T>;
  /**
   * Apply an optimistic update immediately.
   * Returns the created entry so callers can start polling for confirmation.
   */
  apply: (
    key: string,
    operation: OptimisticOperationType,
    optimisticData: T,
    previousData: T,
    txHash?: string,
  ) => OptimisticEntry<T>;
  /** Mark an entry as confirmed (indexer acknowledged). */
  confirm: (key: string) => void;
  /** Roll back an entry to its previous state and record the error. */
  rollback: (key: string, error: string) => void;
  /** Remove a confirmed/failed entry once the UI has handled it. */
  remove: (key: string) => void;
  /** Convenience: get a single entry by key. */
  get: (key: string) => OptimisticEntry<T> | undefined;
}

export function useOptimisticState<T>(): UseOptimisticStateReturn<T> {
  const [entries, dispatch] = useReducer(
    reducer as (state: OptimisticMap<T>, action: Action<T>) => OptimisticMap<T>,
    new Map<string, OptimisticEntry<T>>(),
  );

  const apply = useCallback(
    (
      key: string,
      operation: OptimisticOperationType,
      optimisticData: T,
      previousData: T,
      txHash?: string,
    ): OptimisticEntry<T> => {
      const entry: OptimisticEntry<T> = {
        key,
        operation,
        optimisticData,
        previousData,
        status: 'pending',
        createdAt: Date.now(),
        txHash,
      };
      dispatch({ type: 'APPLY', entry });
      return entry;
    },
    [],
  );

  const confirm = useCallback((key: string) => {
    dispatch({ type: 'CONFIRM', key });
  }, []);

  const rollback = useCallback((key: string, error: string) => {
    dispatch({ type: 'ROLLBACK', key, error });
  }, []);

  const remove = useCallback((key: string) => {
    dispatch({ type: 'REMOVE', key });
  }, []);

  const get = useCallback(
    (key: string) => entries.get(key),
    [entries],
  );

  return { entries, apply, confirm, rollback, remove, get };
}
