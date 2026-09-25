import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Draft state for the claim filing form (issue #1519).
 *
 * Persists the non-file parts of the form to sessionStorage so a user can
 * navigate away and come back without losing their progress. Evidence files
 * are intentionally excluded from the draft because File objects cannot be
 * serialized and may contain sensitive metadata.
 */

export const CLAIM_DRAFT_STORAGE_KEY = 'claims:file-claim:draft';

export const MIN_EVIDENCE_FILES = 1;

export const MAX_EVIDENCE_FILES = 10;

/** Maximum size for a single evidence file, in bytes (25 MiB). */
export const MAX_EVIDENCE_FILE_BYTES = 25 * 1024 * 1024;

/** MIME types accepted as evidence. */
export const ACCEPTED_EVIDENCE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
] as const;

export type EvidenceUploadStatus =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'error';

export interface EvidenceFile {
  /** Stable client-side id used for progress tracking and removal. */
  id: string;
  file: File;
  status: EvidenceUploadStatus;
  /** Upload progress in the range 0..1. */
  progress: number;
  /** Content hash (e.g. sha256) reported by the uploader once available. */
  hash?: string;
  /** IPFS URI (e.g. ipfs://bafy...) reported by the uploader once available. */
  ipfsUri?: string;
  /** Human readable error message when status is 'error'. */
  error?: string;
}

export interface ClaimDraft {
  policyId: string;
  amount: string;
  description: string;
}

export const EMPTY_CLAIM_DRAFT: ClaimDraft = {
  policyId: '',
  amount: '',
  description: '',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readDraft(): ClaimDraft {
  if (typeof window === 'undefined') return EMPTY_CLAIM_DRAFT;
  try {
    const raw = window.sessionStorage.getItem(CLAIM_DRAFT_STORAGE_KEY);
    if (!raw) return EMPTY_CLAIM_DRAFT;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return EMPTY_CLAIM_DRAFT;
    return {
      policyId: typeof parsed.policyId === 'string' ? parsed.policyId : '',
      amount: typeof parsed.amount === 'string' ? parsed.amount : '',
      description:
        typeof parsed.description === 'string' ? parsed.description : '',
    };
  } catch {
    return EMPTY_CLAIM_DRAFT;
  }
}

function writeDraft(draft: ClaimDraft): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      CLAIM_DRAFT_STORAGE_KEY,
      JSON.stringify(draft),
    );
  } catch {
    // Storage may be unavailable (private mode, quota). Draft persistence is
    // best-effort and must never break the form.
  }
}

function clearStoredDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(CLAIM_DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Validate a candidate evidence file before it is uploaded.
 * Returns an error message, or null when the file is acceptable.
 */
export function validateEvidenceFile(file: File): string | null {
  if (!ACCEPTED_EVIDENCE_TYPES.includes(file.type as (typeof ACCEPTED_EVIDENCE_TYPES)[number])) {
    return `Unsupported file type: ${file.type || 'unknown'}`;
  }
  if (file.size > MAX_EVIDENCE_FILE_BYTES) {
    return `File is too large (max ${Math.round(
      MAX_EVIDENCE_FILE_BYTES / (1024 * 1024),
    )} MB)`;
  }
  if (file.size === 0) {
    return 'File is empty';
  }
  return null;
}

/**
 * Validate the number of evidence files against the min/max bounds.
 * Returns an error message, or null when the count is acceptable.
 */
export function validateEvidenceCount(count: number): string | null {
  if (count < MIN_EVIDENCE_FILES) {
    return `Attach at least ${MIN_EVIDENCE_FILES} evidence file${
      MIN_EVIDENCE_FILES === 1 ? '' : 's'
    }`;
  }
  if (count > MAX_EVIDENCE_FILES) {
    return `Attach at most ${MAX_EVIDENCE_FILES} evidence files`;
  }
  return null;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `evidence-${Date.now()}-${idCounter}`;
}

export interface UseClaimDraftResult {
  draft: ClaimDraft;
  setDraft: (patch: Partial<ClaimDraft>) => void;
  resetDraft: () => void;
  evidence: EvidenceFile[];
  /** Add files, validating type/size and enforcing the max count. */
  addFiles: (files: FileList | File[]) => { added: number; errors: string[] };
  removeFile: (id: string) => void;
  /** Update progress/status/hash/ipfs for a single evidence file. */
  updateFile: (id: string, patch: Partial<Omit<EvidenceFile, 'id' | 'file'>>) => void;
  /** Reset a failed file back to 'pending' so it can be retried. */
  retryFile: (id: string) => void;
  clearEvidence: () => void;
}

/**
 * Hook backing the claim filing form. Keeps the text draft in sessionStorage
 * (files excluded) and manages the in-memory evidence upload list.
 */
export function useClaimDraft(): UseClaimDraftResult {
  const [draft, setDraftState] = useState<ClaimDraft>(() => readDraft());
  const [evidence, setEvidence] = useState<EvidenceFile[]>([]);
  const hydrated = useRef(false);

  // Persist the draft (without files) whenever it changes.
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    writeDraft(draft);
  }, [draft]);

  const setDraft = useCallback((patch: Partial<ClaimDraft>) => {
    setDraftState((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetDraft = useCallback(() => {
    setDraftState(EMPTY_CLAIM_DRAFT);
    clearStoredDraft();
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files);
    const errors: string[] = [];
    let added = 0;

    setEvidence((prev) => {
      const next = [...prev];
      for (const file of incoming) {
        if (next.length >= MAX_EVIDENCE_FILES) {
          errors.push(`Attach at most ${MAX_EVIDENCE_FILES} evidence files`);
          break;
        }
        const validationError = validateEvidenceFile(file);
        if (validationError) {
          errors.push(`${file.name}: ${validationError}`);
          continue;
        }
        next.push({
          id: nextId(),
          file,
          status: 'pending',
          progress: 0,
        });
        added += 1;
      }
      return next;
    });

    return { added, errors };
  }, []);

  const removeFile = useCallback((id: string) => {
    setEvidence((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const updateFile = useCallback(
    (id: string, patch: Partial<Omit<EvidenceFile, 'id' | 'file'>>) => {
      setEvidence((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
    },
    [],
  );

  const retryFile = useCallback((id: string) => {
    setEvidence((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, status: 'pending', progress: 0, error: undefined }
          : item,
      ),
    );
  }, []);

  const clearEvidence = useCallback(() => {
    setEvidence([]);
  }, []);

  return {
    draft,
    setDraft,
    resetDraft,
    evidence,
    addFiles,
    removeFile,
    updateFile,
    retryFile,
    clearEvidence,
  };
}
