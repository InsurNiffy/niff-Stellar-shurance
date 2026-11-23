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

export default function QuotePage() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { result, loading, error, stale, fetchQuote, markStale } = useQuote();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const input = useMemo(() => parseForm(form), [form]);

  const update = useCallback(
    (key: keyof FormState, value: string) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setFieldErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      markStale();
    },
    [markStale],
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

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Get a quote</h1>
      <p className="mt-1 text-sm text-gray-600">
        Tell us about your risk and we&apos;ll estimate your premium.
      </p>

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
            value={form.age}
            onChange={(e) => update('age', e.target.value)}
            placeholder="e.g. 34"
            className="mt-1 rounded-md border border-gray-300 px-3 py-2"
          />
          {fieldErrors.age && (
            <span className="mt-1 text-xs text-red-600">{fieldErrors.age}</span>
          )}
        </label>

        <div className="flex items-end">
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Calculating…' : 'Get quote'}
          </button>
        </div>
      </form>

      <section className="mt-8" aria-live="polite">
        {loading && (
          <div className="animate-pulse rounded-lg border border-gray-200 p-6">
            <div className="mb-3 h-5 w-1/3 rounded bg-gray-200" />
            <div className="h-3 w-2/3 rounded bg-gray-200" />
          </div>
        )}

        {error && !loading && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {result && !loading && !error && (
          <div className="rounded-lg border border-gray-200 p-6">
            {stale && (
              <p className="mb-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                Your inputs changed — this quote may be out of date.
              </p>
            )}
            <p className="text-sm text-gray-600">Estimated premium</p>
            <p className="mt-1 text-3xl font-bold text-gray-900">
              {formatPremium(result.premium, result.currency)}
            </p>

            <h2 className="mt-6 text-sm font-semibold text-gray-900">Coverage breakdown</h2>
            <ul className="mt-2 divide-y divide-gray-100">
              {result.breakdown.map((line) => (
                <li key={line.label} className="flex justify-between py-2 text-sm">
                  <span className="text-gray-700">{line.label}</span>
                  <span className="font-medium text-gray-900">
                    {formatPremium(line.amount, result.currency)}
                  </span>
                </li>
              ))}
            </ul>

            <Link
              href="/purchase"
              className="mt-6 inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Proceed to Purchase
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
