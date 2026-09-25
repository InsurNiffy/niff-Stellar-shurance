import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * File a claim with evidence upload.
 *
 * Flow: select policy -> amount (validated against coverage) -> describe incident
 * -> upload evidence (drag & drop, per-file progress, validation, retry, removal)
 * -> review (hash + IPFS link per file, filing fee) -> sign.
 *
 * A draft is persisted in sessionStorage, excluding files.
 */

export interface Policy {
  id: string;
  name: string;
  coverage: number;
  filingFee: number;
}

export interface EvidenceFile {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'uploaded' | 'error';
  progress: number;
  hash?: string;
  ipfsUrl?: string;
  error?: string;
}

export interface FileClaimFormProps {
  policies: Policy[];
  minEvidence?: number;
  maxEvidence?: number;
  /** Uploads a single file, reporting progress 0..1. Resolves with hash + ipfs url. */
  uploadEvidence?: (
    file: File,
    onProgress: (progress: number) => void,
  ) => Promise<{ hash: string; ipfsUrl: string }>;
  onSubmit?: (payload: {
    policyId: string;
    amount: number;
    description: string;
    evidence: { hash: string; ipfsUrl: string }[];
  }) => void | Promise<void>;
}

const DRAFT_KEY = 'claim-draft';
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
const DESCRIPTION_MAX = 2000;

interface Draft {
  policyId: string;
  amount: string;
  description: string;
}

function loadDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function saveDraft(draft: Draft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* storage unavailable — ignore */
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

function validateFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return 'Unsupported file type. Use PNG, JPEG, WEBP, or PDF.';
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'File exceeds the 25 MB limit.';
  }
  return null;
}

let idCounter = 0;
const nextId = () => `ev-${Date.now()}-${idCounter++}`;

export const FileClaimForm: React.FC<FileClaimFormProps> = ({
  policies,
  minEvidence = 1,
  maxEvidence = 10,
  uploadEvidence,
  onSubmit,
}) => {
  const draft = useMemo(loadDraft, []);
  const [policyId, setPolicyId] = useState(draft?.policyId ?? '');
  const [amount, setAmount] = useState(draft?.amount ?? '');
  const [description, setDescription] = useState(draft?.description ?? '');
  const [evidence, setEvidence] = useState<EvidenceFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedPolicy = policies.find((p) => p.id === policyId);
  const amountValue = Number(amount);
  const amountError =
    amount !== '' && selectedPolicy && amountValue > selectedPolicy.coverage
      ? `Amount exceeds coverage of ${selectedPolicy.coverage}.`
      : amount !== '' && (Number.isNaN(amountValue) || amountValue <= 0)
        ? 'Enter a positive amount.'
        : null;

  const uploadedCount = evidence.filter((e) => e.status === 'uploaded').length;
  const evidenceError =
    uploadedCount < minEvidence
      ? `At least ${minEvidence} evidence file(s) required.`
      : uploadedCount > maxEvidence
        ? `At most ${maxEvidence} evidence file(s) allowed.`
        : null;

  useEffect(() => {
    saveDraft({ policyId, amount, description });
  }, [policyId, amount, description]);

  const runUpload = useCallback(
    async (id: string, file: File) => {
      if (!uploadEvidence) return;
      setEvidence((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, status: 'uploading', progress: 0, error: undefined } : e,
        ),
      );
      try {
        const result = await uploadEvidence(file, (progress) => {
          setEvidence((prev) => prev.map((e) => (e.id === id ? { ...e, progress } : e)));
        });
        setEvidence((prev) =>
          prev.map((e) =>
            e.id === id
              ? { ...e, status: 'uploaded', progress: 1, hash: result.hash, ipfsUrl: result.ipfsUrl }
              : e,
          ),
        );
      } catch (err) {
        setEvidence((prev) =>
          prev.map((e) =>
            e.id === id
              ? { ...e, status: 'error', error: err instanceof Error ? err.message : 'Upload failed' }
              : e,
          ),
        );
      }
    },
    [uploadEvidence],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files);
      setEvidence((prev) => {
        const room = Math.max(0, maxEvidence - prev.length);
        const accepted = incoming.slice(0, room);
        const next: EvidenceFile[] = accepted.map((file) => {
          const validationError = validateFile(file);
          return {
            id: nextId(),
            file,
            status: validationError ? 'error' : 'pending',
            progress: 0,
            error: validationError ?? undefined,
          };
        });
        // Kick off uploads for valid files.
        next.forEach((entry) => {
          if (entry.status === 'pending') void runUpload(entry.id, entry.file);
        });
        return [...prev, ...next];
      });
    },
    [maxEvidence, runUpload],
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const removeFile = (id: string) => {
    setEvidence((prev) => prev.filter((e) => e.id !== id));
  };

  const retryFile = (entry: EvidenceFile) => {
    const validationError = validateFile(entry.file);
    if (validationError) {
      setEvidence((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, error: validationError } : e)),
      );
      return;
    }
    void runUpload(entry.id, entry.file);
  };

  const canSubmit =
    !!selectedPolicy &&
    !amountError &&
    amount !== '' &&
    description.trim().length > 0 &&
    !evidenceError &&
    evidence.every((e) => e.status === 'uploaded') &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !selectedPolicy) return;
    setSubmitting(true);
    try {
      await onSubmit?.({
        policyId,
        amount: amountValue,
        description,
        evidence: evidence.map((e) => ({ hash: e.hash!, ipfsUrl: e.ipfsUrl! })),
      });
      clearDraft();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="file-claim-form"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
    >
      <h2>File a claim</h2>

      <label>
        Policy
        <select value={policyId} onChange={(e) => setPolicyId(e.target.value)} required>
          <option value="">Select a policy…</option>
          {policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} (coverage {p.coverage})
            </option>
          ))}
        </select>
      </label>

      <label>
        Claim amount
        <input
          type="number"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={!!amountError}
          required
        />
        {amountError && <span className="error">{amountError}</span>}
      </label>

      <label>
        Describe the incident
        <textarea
          value={description}
          maxLength={DESCRIPTION_MAX}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
        <span className="char-counter">
          {description.length}/{DESCRIPTION_MAX}
        </span>
      </label>

      <section className="evidence">
        <h3>Evidence</h3>
        <p className="notice">
          Images are stripped of location metadata before upload. Evidence is stored publicly on
          IPFS and will be visible to anyone.
        </p>

        <div
          className={`dropzone${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          Drag &amp; drop files here, or click to browse
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_TYPES.join(',')}
            hidden
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        <ul className="evidence-list">
          {evidence.map((entry) => (
            <li key={entry.id} className={`evidence-item ${entry.status}`}>
              <span className="name">{entry.file.name}</span>
              {entry.status === 'uploading' && (
                <progress value={entry.progress} max={1} aria-label="upload progress" />
              )}
              {entry.status === 'uploaded' && <span className="ok">Uploaded</span>}
              {entry.status === 'error' && (
                <span className="error">
                  {entry.error}{' '}
                  <button type="button" onClick={() => retryFile(entry)}>
                    Retry
                  </button>
                </span>
              )}
              <button type="button" onClick={() => removeFile(entry.id)} aria-label="Remove file">
                Remove
              </button>
            </li>
          ))}
        </ul>
        {evidenceError && <span className="error">{evidenceError}</span>}
      </section>

      <section className="review">
        <h3>Review</h3>
        <ul>
          {evidence
            .filter((e) => e.status === 'uploaded')
            .map((e) => (
              <li key={e.id}>
                <span className="name">{e.file.name}</span>
                <code className="hash">{e.hash}</code>
                <a href={e.ipfsUrl} target="_blank" rel="noreferrer noopener">
                  View on IPFS
                </a>
              </li>
            ))}
        </ul>
        {selectedPolicy && (
          <p className="filing-fee">Filing fee: {selectedPolicy.filingFee}</p>
        )}
      </section>

      <button type="submit" disabled={!canSubmit}>
        {submitting ? 'Signing…' : 'Sign & file claim'}
      </button>
    </form>
  );
};

export default FileClaimForm;
