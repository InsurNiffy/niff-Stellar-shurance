'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ClaimDraft = {
  amount: string;
  details: string;
  narrative: string;
};

const EMPTY_DRAFT: ClaimDraft = {
  amount: '',
  details: '',
  narrative: '',
};

const STORAGE_PREFIX = 'claim-draft:';

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

function readDraft(key: string): ClaimDraft {
  if (typeof window === 'undefined') return EMPTY_DRAFT;
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw) as Partial<ClaimDraft>;
    return {
      amount: typeof parsed.amount === 'string' ? parsed.amount : '',
      details: typeof parsed.details === 'string' ? parsed.details : '',
      narrative: typeof parsed.narrative === 'string' ? parsed.narrative : '',
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

/**
 * Persists only the text fields of a claim draft (amount, details, narrative).
 * File objects are intentionally never serialized — evidence must be
 * re-uploaded on resume.
 */
export function useDraftPersistence(key: string) {
  const [draft, setDraft] = useState<ClaimDraft>(EMPTY_DRAFT);
  const [hydrated, setHydrated] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(readDraft(key));
    setHydrated(true);
  }, [key]);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey(key), JSON.stringify(draft));
      } catch {
        // Ignore quota / serialization errors — persistence is best-effort.
      }
    }, 300);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [key, draft, hydrated]);

  const updateField = useCallback(
    <K extends keyof ClaimDraft>(field: K, value: ClaimDraft[K]) => {
      setDraft((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const clearDraft = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(storageKey(key));
      } catch {
        // ignore
      }
    }
  }, [key]);

  return { draft, updateField, clearDraft, hydrated };
}
