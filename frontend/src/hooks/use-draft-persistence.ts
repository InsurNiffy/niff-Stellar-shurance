'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * Draft state with TTL and Versioning.
 */
interface DraftWrapper<T> {
  _v: number;
  _ts: number;
  data: T;
}

/**
 * Persists form state to localStorage with a TTL and schema versioning.
 * Filters out non-serializable objects (like File or IPFS blobs).
 * 
 * Note: Drafts are device-local and are NOT synced across sessions or devices.
 *
 * @param formKey Unique key for storage
 * @param schemaVersion Version of the form schema (mismatches clear draft)
 * @param ttlMs Time-to-live in milliseconds (default 24h)
 */
export function useDraftPersistence<T extends Record<string, any>>(
  formKey: string,
  schemaVersion: number,
  ttlMs: number = 24 * 60 * 60 * 1000
) {
  const [hasDraft, setHasDraft] = useState(false);
  const storageKey = `niffyinsur-draft-${formKey}`;

  // Check for existing draft on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        setHasDraft(false);
        return;
      }

      const wrapper = JSON.parse(raw) as DraftWrapper<T>;
      const now = Date.now();

      // Validate TTL and Version
      if (
        wrapper._v !== schemaVersion ||
        now - wrapper._ts > ttlMs
      ) {
        localStorage.removeItem(storageKey);
        setHasDraft(false);
      } else {
        setHasDraft(true);
      }
    } catch (e) {
      console.error('Error checking draft persistence:', e);
      setHasDraft(false);
    }
  }, [storageKey, schemaVersion, ttlMs]);

  /**
   * Deep-strips non-persistable values (File objects, IPFS URLs if requested).
   * Note: The issue specifies not persisting 'sensitive evidence file references'.
   */
  const sanitize = useCallback((data: T): T => {
    const isFile = (v: unknown) =>
      !!v &&
      typeof v === 'object' &&
      ((v as { constructor?: { name?: string } }).constructor?.name === 'File' ||
        (v as { constructor?: { name?: string } }).constructor?.name === 'Blob' ||
        (typeof File !== 'undefined' && v instanceof File) ||
        (typeof Blob !== 'undefined' && v instanceof Blob));

    const hasIpfsUrl = (v: string) =>
      v.toLowerCase().includes('ipfs://') || v.toLowerCase().includes('/ipfs/');

    /** Returns undefined for values that must never reach localStorage. */
    const clean = (value: unknown): unknown => {
      if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
      if (typeof value === 'string') return hasIpfsUrl(value) ? undefined : value;
      if (isFile(value)) return undefined;
      if (Array.isArray(value)) {
        const cleaned = value.map(clean).filter((v) => v !== undefined);
        return cleaned.length === value.length ? cleaned : undefined;
      }
      if (typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
          const cleanedNested = clean(nested);
          if (cleanedNested !== undefined) result[key] = cleanedNested;
        }
        return Object.keys(result).length === Object.keys(value as object).length ? result : undefined;
      }
      return undefined; // functions, symbols, bigints, etc.
    };

    const result: Record<string, unknown> = {};
    Object.entries(data).forEach(([key, value]) => {
      // Evidence arrays always hold file references — files must be re-uploaded.
      if (key === 'evidence') return;
      const cleaned = clean(value);
      if (cleaned !== undefined) result[key] = cleaned;
    });
    return result as T;
  }, []);

  const saveDraft = useCallback((data: T) => {
    if (typeof window === 'undefined') return;

    const sanitized = sanitize(data);
    const wrapper: DraftWrapper<T> = {
      _v: schemaVersion,
      _ts: Date.now(),
      data: sanitized,
    };

    localStorage.setItem(storageKey, JSON.stringify(wrapper));
    setHasDraft(true);
  }, [storageKey, schemaVersion, sanitize]);

  const loadDraft = useCallback((): T | null => {
    if (typeof window === 'undefined') return null;

    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;

      const wrapper = JSON.parse(raw) as DraftWrapper<T>;
      return wrapper.data;
    } catch {
      return null;
    }
  }, [storageKey]);

  const clearDraft = useCallback(() => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(storageKey);
    setHasDraft(false);
  }, [storageKey]);

  return {
    hasDraft,
    saveDraft,
    loadDraft,
    clearDraft,
  };
}
