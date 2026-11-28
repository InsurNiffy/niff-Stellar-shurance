'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';

type PolicyType = 'auto' | 'home' | 'life' | 'health';

const POLICY_TYPES: { value: PolicyType; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'home', label: 'Home' },
  { value: 'life', label: 'Life' },
  { value: 'health', label: 'Health' },
];

const REGIONS = ['us-east', 'us-west', 'eu-central', 'ap-south'] as const;

const quoteSchema = z.object({
  policyType: z.enum(['auto', 'home', 'life', 'health']),
  region: z.enum(REGIONS),
  coverageAmount: z
    .number({ invalid_type_error: 'Coverage amount is required' })
    .positive('Coverage amount must be greater than zero')
    .max(10_000_000, 'Coverage amount is too large'),
  riskScore: z
    .number({ invalid_type_error: 'Risk score is required' })
    .min(0, 'Risk score must be between 0 and 100')
    .max(100, 'Risk score must be between 0 and 100'),
  age: z
    .number({ invalid_type_error: 'Age is required' })
    .int('Age must be a whole number')
    .min(18, 'You must be at least 18')
    .max(120, 'Please enter a valid age'),
});

type QuoteInput = z.infer<typeof quoteSchema>;

interface CoverageLine {
  label: string;
  amount: number;
}

interface QuoteResult {
  premium: number;
  currency: string;
  breakdown: CoverageLine[];
}

interface FormState {
  policyType: PolicyType;
  region: (typeof REGIONS)[number];
  coverageAmount: string;
  riskScore: string;
  age: string;
}

const INITIAL_FORM: FormState = {
  policyType: 'auto',
  region: 'us-east',
  coverageAmount: '',
  riskScore: '',
  age: '',
};

const DRAFT_KEY = 'purchase-wizard-draft';

type WizardStep = 'quote' | 'coverage' | 'sign';

const WIZARD_STEPS: { id: WizardStep; label: string }[] = [
  { id: 'quote', label: 'Quote review' },
  { id: 'coverage', label: 'Coverage details' },
  { id: 'sign', label: 'Wallet sign' },
];

interface DraftState {
  form: FormState;
  step: WizardStep;
}

function formatPremium(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function parseForm(form: FormState): QuoteInput | null {
  const parsed = quoteSchema.safeParse({
    policyType: form.policyType,
    region: form.region,
    coverageAmount: form.coverageAmount === '' ? NaN : Number(form.coverageAmount),
    riskScore: form.riskScore === '' ? NaN : Number(form.riskScore),
    age: form.age === '' ? NaN : Number(form.age),
  });
  return parsed.success ? parsed.data : null;
}

function useDraftPersistence(initial: DraftState) {
  const [draft, setDraft] = useState<DraftState>(initial);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<DraftState>;
        if (parsed && parsed.form) {
          setDraft({
            form: { ...initial.form, ...parsed.form },
            step: parsed.step ?? initial.step,
          });
          setRestored(true);
        }
      }
    } catch {
      /* ignore corrupt drafts */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* storage may be unavailable */
    }
  }, [draft]);

  const clearDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    setRestored(false);
  }, []);

  return { draft, setDraft, restored, clearDraft };
}

function useQuote() {
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const requestId = useRef(0);

  const fetchQuote = useCallback(async (input: QuoteInput) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    setStale(false);
    try {
      const res = await fetch('/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        let message = 'We could not generate a quote. Please try again.';
        try {
          const body = (await res.json()) as { message?: string; error?: string };
          message = body.message ?? body.error ?? message;
        } catch {
          /* keep default message */
        }
        throw new Error(message);
      }
      const data = (await res.json()) as QuoteResult;
      if (id !== requestId.current) return;
      setResult(data);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  const markStale = useCallback(() => {
    setStale(true);
  }, []);

  return { result, loading, error, stale, fetchQuote, markStale };
}

function useTransactionStatus(hash: string | null) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'failed'>('idle');

  useEffect(() => {
    if (!hash) {
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('pending');
    const poll = async () => {
      try {
        const res = await fetch(`/tx/status/${encodeURIComponent(hash)}`);
        if (!res.ok) return;
        const body = (await res.json()) as { status?: string };
        if (cancelled) return;
        if (body.status === 'success') setStatus('success');
        else if (body.status === 'failed') setStatus('failed');
      } catch {
        /* keep polling */
      }
    };
    void poll();
    const timer = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hash]);

  return status;
}

interface WalletSignStepProps {
  quote: QuoteInput;
  onConfirmed: () => void;
}

function WalletSignStep({ quote, onConfirmed }: WalletSignStepProps) {
  const [xdr, setXdr] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useTransactionStatus(txHash);

  useEffect(() => {
    if (status === 'success') onConfirmed();
  }, [status, onConfirmed]);

  const handleSign = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      let unsigned = xdr;
      if (!unsigned) {
        const buildRes = await fetch('/policies/build-transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(quote),
        });
        if (!buildRes.ok) throw new Error('Could not build the transaction.');
        const built = (await buildRes.json()) as { xdr: string };
        unsigned = built.xdr;
        setXdr(unsigned);
      }
      const signed = await signTransaction(unsigned);
      const submitRes = await fetch('/tx/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xdr: signed }),
      });
      if (!submitRes.ok) throw new Error('Transaction submission failed.');
      const submitted = (await submitRes.json()) as { hash: string };
      setTxHash(submitted.hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signing failed.');
    } finally {
      setBusy(false);
    }
  }, [quote, xdr]);

  return (
    <div className="grid gap-3">
      <p className="text-sm text-gray-600">
        Sign the policy transaction with your wallet to complete the purchase.
      </p>
      <button
        type="button"
        onClick={handleSign}
        disabled={busy || status === 'pending' || status === 'success'}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Signing…' : status === 'pending' ? 'Confirming…' : 'Sign & submit'}
      </button>
      {status === 'success' && (
        <p className="text-sm text-green-700">Transaction confirmed. Your policy is active.</p>
      )}
      {status === 'failed' && (
        <p className="text-sm text-red-600">Transaction failed. Please try again.</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

async function signTransaction(xdr: string): Promise<string> {
  const freighter = (window as unknown as {
    freighter?: { signTransaction?: (x: string) => Promise<{ signedXDR?: string }> };
  }).freighter;
  if (!freighter?.signTransaction) {
    throw new Error('Wallet not available. Please install a Stellar wallet.');
  }
  const result = await freighter.signTransaction(xdr);
  if (!result?.signedXDR) throw new Error('Wallet did not return a signed transaction.');
  return result.signedXDR;
}

export default function QuotePage() {
  const { draft, setDraft, restored, clearDraft } = useDraftPersistence({
    form: INITIAL_FORM,
    step: 'quote',
  });
  const form = draft.form;
  const step = draft.step;
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { result, loading, error, stale, fetchQuote, markStale } = useQuote();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const input = useMemo(() => parseForm(form), [form]);

  const update = useCallback(
    (key: keyof FormState, value: string) => {
      setDraft((prev) => ({ ...prev, form: { ...prev.form, [key]: value } }));
      setFieldErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      markStale();
    },
    [markStale, setDraft],
  );

  const goToStep = useCallback(
    (next: WizardStep) => {
      setDraft((prev) => ({ ...prev, step: next }));
    },
    [setDraft],
  );

  useEffect(() => {
    if (!input) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchQuote(input);
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input, fetchQuote]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const parsed = quoteSchema.safeParse({
        policyType: form.policyType,
        region: form.region,
        coverageAmount: form.coverageAmount === '' ? NaN : Number(form.coverageAmount),
        riskScore: form.riskScore === '' ? NaN : Number(form.riskScore),
        age: form.age === '' ? NaN : Number(form.age),
      });
      if (!parsed.success) {
        const errors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = String(issue.path[0] ?? 'form');
          if (!errors[key]) errors[key] = issue.message;
        }
        setFieldErrors(errors);
        return;
      }
      setFieldErrors({});
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void fetchQuote(parsed.data);
    },
    [fetchQuote, form],
  );

  const handleConfirmed = useCallback(() => {
    clearDraft();
  }, [clearDraft]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Purchase a policy</h1>
      <p className="mt-1 text-sm text-gray-600">
        Review your quote, confirm coverage, then sign with your wallet.
      </p>

      <ol className="mt-4 flex gap-2 text-xs text-gray-500">
        {WIZARD_STEPS.map((s, i) => (
          <li
            key={s.id}
            className={s.id === step ? 'font-semibold text-indigo-600' : undefined}
          >
            {i + 1}. {s.label}
          </li>
        ))}
      </ol>

      {restored && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Resumed your saved draft.
        </p>
      )}

      {step === 'quote' && (
        <form onSubmit={handleSubmit} className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col text-sm text-gray-700">
            Policy type
            <select
              value={form.policyType}
              onChange={(e) => update('policyType', e.target.value)}
              className="mt-1 rounded-md border border-gray-300 px-3 py-2"
            >
              {POLICY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-sm text-gray-700">
            Region
            <select
              value={form.region}
              onChange={(e) => update('region', e.target.value)}
              className="mt-1 rounded-md border border-gray-300 px-3 py-2"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-sm text-gray-700">
            Coverage amount
            <input
              type="number"
              min={0}
              value={form.coverageAmount}
              onChange={(e) => update('coverageAmount', e.target.value)}
              placeholder="e.g. 250000"
              className="mt-1 rounded-md border border-gray-300 px-3 py-2"
            />
            {fieldErrors.coverageAmount && (
              <span className="mt-1 text-xs text-red-600">{fieldErrors.coverageAmount}</span>
            )}
          </label>

          <label className="flex flex-col text-sm text-gray-700">
            Risk score (0–100)
            <input
              type="number"
              min={0}
              max={100}
              value={form.riskScore}
              onChange={(e) => update('riskScore', e.target.value)}
              placeholder="e.g. 35"
              className="mt-1 rounded-md border border-gray-300 px-3 py-2"
            />
            {fieldErrors.riskScore && (
              <span className="mt-1 text-xs text-red-600">{fieldErrors.riskScore}</span>
            )}
          </label>

          <label className="flex flex-col text-sm text-gray-700">
            Age
            <input
              type="number"
              min={18}
              max={120}
              value={form.age}
              onChange={(e) => update('age', e.target.value)}
              placeholder="e.g. 32"
              className="mt-1 rounded-md border border-gray-300 px-3 py-2"
            />
            {fieldErrors.age && (
              <span className="mt-1 text-xs text-red-600">{fieldErrors.age}</span>
            )}
          </label>

          <div className="sm:col-span-2 flex items-center gap-3">
            <button
              type="submit"
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
            >
              {loading ? 'Calculating…' : 'Review quote'}
            </button>
            {result && (
              <button
                type="button"
                onClick={() => goToStep('coverage')}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
              >
                Continue
              </button>
            )}
          </div>
        </form>
      )}

      {step === 'quote' && error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {step === 'quote' && result && (
        <section className="mt-6 rounded-lg border border-gray-200 p-4">
          <h2 className="text-lg font-semibold text-gray-900">Quote review</h2>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {formatPremium(result.premium, result.currency)}
          </p>
          {stale && <p className="mt-1 text-xs text-amber-600">Inputs changed — refresh the quote.</p>}
          <ul className="mt-3 divide-y divide-gray-100 text-sm text-gray-700">
            {result.breakdown.map((line) => (
              <li key={line.label} className="flex justify-between py-1">
                <span>{line.label}</span>
                <span>{formatPremium(line.amount, result.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 'coverage' && (
        <section className="mt-6 grid gap-3 rounded-lg border border-gray-200 p-4 text-sm text-gray-700">
          <h2 className="text-lg font-semibold text-gray-900">Coverage details</h2>
          <p>Policy type: {form.policyType}</p>
          <p>Region: {form.region}</p>
          <p>Coverage amount: {form.coverageAmount}</p>
          <p>Risk score: {form.riskScore}</p>
          <p>Age: {form.age}</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => goToStep('quote')}
              className="rounded-md border border-gray-300 px-4 py-2 font-medium text-gray-700"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => goToStep('sign')}
              className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white"
            >
              Continue to signing
            </button>
          </div>
        </section>
      )}

      {step === 'sign' && input && (
        <section className="mt-6 grid gap-3 rounded-lg border border-gray-200 p-4">
          <h2 className="text-lg font-semibold text-gray-900">Wallet sign</h2>
          <WalletSignStep quote={input} onConfirmed={handleConfirmed} />
          <button
            type="button"
            onClick={() => goToStep('coverage')}
            className="w-fit rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
          >
            Back
          </button>
        </section>
      )}

      <p className="mt-6 text-sm text-gray-600">
        <Link href="/" className="text-indigo-600 hover:underline">
          Back to home
        </Link>
      </p>
    </main>
  );
}
