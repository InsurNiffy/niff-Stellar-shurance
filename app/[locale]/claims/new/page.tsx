'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';
const DRAFT_KEY = 'claim-wizard-draft';

const STEPS = ['Amount', 'Details', 'Evidence', 'Narrative', 'Review'] as const;
type Step = (typeof STEPS)[number];

interface EvidenceItem {
  name: string;
  size: number;
  cid: string;
  hash: string;
}

interface DraftState {
  amount: string;
  incidentDate: string;
  category: string;
  details: string;
  narrative: string;
}

const EMPTY_DRAFT: DraftState = {
  amount: '',
  incidentDate: '',
  category: '',
  details: '',
  narrative: '',
};

function useDraftPersistence() {
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<DraftState>;
        setDraft({ ...EMPTY_DRAFT, ...parsed });
        setRestored(true);
      }
    } catch {
      // ignore malformed drafts
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // storage may be unavailable
    }
  }, [draft]);

  const update = useCallback(<K extends keyof DraftState>(key: K, value: DraftState[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const clear = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
  }, []);

  return { draft, update, clear, restored };
}

async function computeHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function ClaimWizardPage() {
  const router = useRouter();
  const { draft, update, clear, restored } = useDraftPersistence();
  const [stepIndex, setStepIndex] = useState(0);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const step: Step = STEPS[stepIndex];

  const amountValid = useMemo(() => {
    const n = Number(draft.amount);
    return draft.amount.trim() !== '' && Number.isFinite(n) && n > 0;
  }, [draft.amount]);

  const detailsValid = useMemo(
    () => draft.incidentDate.trim() !== '' && draft.category.trim() !== '' && draft.details.trim() !== '',
    [draft.incidentDate, draft.category, draft.details],
  );

  const narrativeValid = draft.narrative.trim().length > 0;

  const canAdvance = useMemo(() => {
    switch (step) {
      case 'Amount':
        return amountValid;
      case 'Details':
        return detailsValid;
      case 'Evidence':
        return evidence.length > 0 && !uploading;
      case 'Narrative':
        return narrativeValid;
      default:
        return true;
    }
  }, [step, amountValid, detailsValid, evidence.length, uploading, narrativeValid]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded: EvidenceItem[] = [];
      for (const file of Array.from(files)) {
        const hash = await computeHash(file);
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`${API_BASE}/ipfs/upload`, { method: 'POST', body: form });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        const data = (await res.json()) as { cid?: string; hash?: string };
        uploaded.push({
          name: file.name,
          size: file.size,
          cid: data.cid ?? '',
          hash: data.hash ?? hash,
        });
      }
      setEvidence((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  const removeEvidence = useCallback((cid: string) => {
    setEvidence((prev) => prev.filter((item) => item.cid !== cid));
  }, []);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const buildRes = await fetch(`${API_BASE}/claims/build-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: draft.amount,
          incidentDate: draft.incidentDate,
          category: draft.category,
          details: draft.details,
          narrative: draft.narrative,
          evidence: evidence.map((e) => ({ cid: e.cid, hash: e.hash, name: e.name })),
        }),
      });
      if (!buildRes.ok) throw new Error(`Failed to build transaction (${buildRes.status})`);
      const { xdr } = (await buildRes.json()) as { xdr: string };

      const submitRes = await fetch(`${API_BASE}/tx/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xdr }),
      });
      if (!submitRes.ok) throw new Error(`Failed to submit transaction (${submitRes.status})`);

      clear();
      router.push('/claims');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }, [draft, evidence, clear, router]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">File a Claim</h1>

      <ol className="mt-6 flex flex-wrap gap-2 text-sm">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`rounded-full px-3 py-1 ${
              i === stepIndex
                ? 'bg-blue-600 text-white'
                : i < stepIndex
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-500'
            }`}
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {restored && stepIndex === 0 && (
        <p className="mt-4 rounded bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          Draft restored. Uploaded evidence must be re-uploaded.
        </p>
      )}

      <div className="mt-6 space-y-4">
        {step === 'Amount' && (
          <label className="block">
            <span className="text-sm font-medium">Claim amount</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.amount}
              onChange={(e) => update('amount', e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2"
              placeholder="0.00"
            />
          </label>
        )}

        {step === 'Details' && (
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium">Incident date</span>
              <input
                type="date"
                value={draft.incidentDate}
                onChange={(e) => update('incidentDate', e.target.value)}
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Category</span>
              <input
                type="text"
                value={draft.category}
                onChange={(e) => update('category', e.target.value)}
                className="mt-1 w-full rounded border px-3 py-2"
                placeholder="e.g. flight delay"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Details</span>
              <textarea
                value={draft.details}
                onChange={(e) => update('details', e.target.value)}
                rows={4}
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </label>
          </div>
        )}

        {step === 'Evidence' && (
          <div className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => handleFiles(e.target.files)}
              disabled={uploading}
              className="block w-full text-sm"
            />
            {uploading && <p className="text-sm text-gray-500">Uploading to IPFS…</p>}
            {evidence.length > 0 && (
              <ul className="space-y-2">
                {evidence.map((item) => (
                  <li key={item.cid} className="rounded border p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{item.name}</span>
                      <button
                        type="button"
                        onClick={() => removeEvidence(item.cid)}
                        className="text-red-600"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="mt-1 break-all text-gray-600">CID: {item.cid}</div>
                    <div className="break-all text-gray-600">Hash: {item.hash}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {step === 'Narrative' && (
          <label className="block">
            <span className="text-sm font-medium">Narrative</span>
            <textarea
              value={draft.narrative}
              onChange={(e) => update('narrative', e.target.value)}
              rows={6}
              className="mt-1 w-full rounded border px-3 py-2"
              placeholder="Describe what happened…"
            />
          </label>
        )}

        {step === 'Review' && (
          <div className="space-y-4 text-sm">
            <section className="rounded border p-4">
              <h2 className="font-semibold">Claim inputs</h2>
              <dl className="mt-2 grid grid-cols-2 gap-2">
                <dt className="text-gray-500">Amount</dt>
                <dd>{draft.amount}</dd>
                <dt className="text-gray-500">Incident date</dt>
                <dd>{draft.incidentDate}</dd>
                <dt className="text-gray-500">Category</dt>
                <dd>{draft.category}</dd>
                <dt className="text-gray-500">Details</dt>
                <dd>{draft.details}</dd>
                <dt className="text-gray-500">Narrative</dt>
                <dd>{draft.narrative}</dd>
              </dl>
            </section>
            <section className="rounded border p-4">
              <h2 className="font-semibold">Evidence</h2>
              {evidence.length === 0 ? (
                <p className="text-gray-500">No evidence uploaded.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {evidence.map((item) => (
                    <li key={item.cid} className="break-all">
                      <div className="font-medium">{item.name}</div>
                      <div className="text-gray-600">CID: {item.cid}</div>
                      <div className="text-gray-600">Hash: {item.hash}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>

      {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-6 flex justify-between">
        <button
          type="button"
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          disabled={stepIndex === 0 || submitting}
          className="rounded border px-4 py-2 disabled:opacity-50"
        >
          Back
        </button>
        {step === 'Review' ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Sign & Submit'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))}
            disabled={!canAdvance}
            className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
          >
            Next
          </button>
        )}
      </div>
    </main>
  );
}
