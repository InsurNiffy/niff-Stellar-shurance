'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DRAFT_KEY = 'claim-wizard-draft';

const STEPS = ['Amount', 'Details', 'Evidence', 'Narrative', 'Review'] as const;
type Step = (typeof STEPS)[number];

interface DraftText {
  amount: string;
  policyId: string;
  incidentDate: string;
  details: string;
  narrative: string;
}

interface EvidenceItem {
  name: string;
  cid: string;
  hash: string;
  size: number;
}

const EMPTY_DRAFT: DraftText = {
  amount: '',
  policyId: '',
  incidentDate: '',
  details: '',
  narrative: '',
};

function useDraftPersistence() {
  const [draft, setDraft] = useState<DraftText>(EMPTY_DRAFT);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<DraftText>;
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

  const update = useCallback((patch: Partial<DraftText>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
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

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function ClaimWizard() {
  const { draft, update, clear, restored } = useDraftPersistence();
  const [stepIndex, setStepIndex] = useState(0);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const step: Step = STEPS[stepIndex];

  const canAdvance = useMemo(() => {
    switch (step) {
      case 'Amount':
        return draft.amount.trim() !== '' && Number(draft.amount) > 0;
      case 'Details':
        return draft.policyId.trim() !== '' && draft.incidentDate.trim() !== '';
      case 'Evidence':
        return evidence.length > 0;
      case 'Narrative':
        return draft.narrative.trim().length > 0;
      default:
        return true;
    }
  }, [step, draft, evidence]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const uploaded: EvidenceItem[] = [];
      for (const file of Array.from(files)) {
        const hash = await sha256Hex(file);
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/ipfs/upload', { method: 'POST', body: form });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        const data = (await res.json()) as { cid?: string; hash?: string };
        uploaded.push({
          name: file.name,
          cid: data.cid ?? '',
          hash: data.hash ?? hash,
          size: file.size,
        });
      }
      setEvidence((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
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
    setSubmitError(null);
    try {
      const buildRes = await fetch('/claims/build-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: draft.amount,
          policyId: draft.policyId,
          incidentDate: draft.incidentDate,
          details: draft.details,
          narrative: draft.narrative,
          evidence: evidence.map((e) => ({ cid: e.cid, hash: e.hash, name: e.name })),
        }),
      });
      if (!buildRes.ok) throw new Error(`Build failed (${buildRes.status})`);
      const { xdr } = (await buildRes.json()) as { xdr: string };

      const submitRes = await fetch('/tx/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xdr }),
      });
      if (!submitRes.ok) throw new Error(`Submit failed (${submitRes.status})`);
      const result = (await submitRes.json()) as { hash?: string };
      setTxHash(result.hash ?? 'submitted');
      clear();
      setEvidence([]);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }, [draft, evidence, clear]);

  if (txHash) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-semibold">Claim submitted</h1>
        <p className="mt-2 text-sm text-gray-600">Transaction: {txHash}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">File a claim</h1>
      {restored && (
        <p className="mt-2 text-sm text-amber-600">
          Draft restored. Evidence files must be re-uploaded.
        </p>
      )}

      <ol className="mt-4 flex gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`rounded px-2 py-1 ${i === stepIndex ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      <div className="mt-6 space-y-4">
        {step === 'Amount' && (
          <label className="block">
            <span className="text-sm font-medium">Claim amount</span>
            <input
              type="number"
              min="0"
              value={draft.amount}
              onChange={(e) => update({ amount: e.target.value })}
              className="mt-1 w-full rounded border px-3 py-2"
            />
          </label>
        )}

        {step === 'Details' && (
          <>
            <label className="block">
              <span className="text-sm font-medium">Policy ID</span>
              <input
                type="text"
                value={draft.policyId}
                onChange={(e) => update({ policyId: e.target.value })}
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Incident date</span>
              <input
                type="date"
                value={draft.incidentDate}
                onChange={(e) => update({ incidentDate: e.target.value })}
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Details</span>
              <textarea
                value={draft.details}
                onChange={(e) => update({ details: e.target.value })}
                rows={4}
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </label>
          </>
        )}

        {step === 'Evidence' && (
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => handleFiles(e.target.files)}
              disabled={uploading}
            />
            {uploading && <p className="text-sm text-gray-500">Uploading to IPFS…</p>}
            {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
            <ul className="space-y-2">
              {evidence.map((item) => (
                <li key={item.cid} className="rounded border p-3 text-sm">
                  <div className="font-medium">{item.name}</div>
                  <div className="break-all text-gray-600">CID: {item.cid}</div>
                  <div className="break-all text-gray-600">Hash: {item.hash}</div>
                  <button
                    type="button"
                    onClick={() => removeEvidence(item.cid)}
                    className="mt-1 text-xs text-red-600"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {step === 'Narrative' && (
          <label className="block">
            <span className="text-sm font-medium">Narrative</span>
            <textarea
              value={draft.narrative}
              onChange={(e) => update({ narrative: e.target.value })}
              rows={6}
              className="mt-1 w-full rounded border px-3 py-2"
            />
          </label>
        )}

        {step === 'Review' && (
          <div className="space-y-3 text-sm">
            <div>
              <span className="font-medium">Amount:</span> {draft.amount}
            </div>
            <div>
              <span className="font-medium">Policy ID:</span> {draft.policyId}
            </div>
            <div>
              <span className="font-medium">Incident date:</span> {draft.incidentDate}
            </div>
            <div>
              <span className="font-medium">Details:</span> {draft.details}
            </div>
            <div>
              <span className="font-medium">Narrative:</span> {draft.narrative}
            </div>
            <div>
              <span className="font-medium">Evidence:</span>
              <ul className="mt-1 space-y-1">
                {evidence.map((item) => (
                  <li key={item.cid} className="break-all text-gray-600">
                    {item.name} — CID {item.cid} — hash {item.hash}
                  </li>
                ))}
              </ul>
            </div>
            {submitError && <p className="text-red-600">{submitError}</p>}
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-between">
        <button
          type="button"
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          disabled={stepIndex === 0 || submitting}
          className="rounded border px-4 py-2 text-sm disabled:opacity-50"
        >
          Back
        </button>
        {step === 'Review' ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {submitting ? 'Signing…' : 'Sign & submit'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))}
            disabled={!canAdvance}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
