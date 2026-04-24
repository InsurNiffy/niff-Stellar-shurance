'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

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
    const cleanData = { ...data };
    // According to requirements: "Never persist file objects or IPFS URLs in drafts; only persist text fields."
    Object.keys(cleanData).forEach((key) => {
      const value = cleanData[key];
      
      // Robust Check for File objects (works in environments where File may not be defined globally)
      const isFile = (v: any) => 
        v?.constructor?.name === 'File' || 
        v?.constructor?.name === 'Blob' ||
        (typeof File !== 'undefined' && v instanceof File) ||
        (typeof Blob !== 'undefined' && v instanceof Blob);

      if (isFile(value) || (Array.isArray(value) && value.some(isFile))) {
        delete cleanData[key];
        return;
      }
      
      // Remove IPFS-like URLs or evidence fields if they contain them
      // In this specific app, EvidenceStep uses objects with 'url'
      if (key === 'evidence' && Array.isArray(value)) {
        delete cleanData[key];
        return;
      }
      
      // Remove raw IPFS URLs if detected in strings
      if (typeof value === 'string' && (value.toLowerCase().includes('ipfs://') || value.toLowerCase().includes('/ipfs/'))) {
        delete cleanData[key];
      }
    });

    return cleanData;
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
