'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const POLICY_TYPES = ['auto', 'home', 'travel', 'health'] as const;
const REGIONS = ['north', 'south', 'east', 'west'] as const;
const AGE_BANDS = ['18-25', '26-35', '36-50', '51-65', '65+'] as const;
const COVERAGE_TIERS = ['basic', 'standard', 'premium'] as const;
const ASSETS = ['car', 'house', 'apartment', 'bike', 'phone'] as const;

const quoteSchema = z.object({
  policyType: z.enum(POLICY_TYPES),
  region: z.enum(REGIONS),
  ageBand: z.enum(AGE_BANDS),
  coverageTier: z.enum(COVERAGE_TIERS),
  safetyScore: z.coerce.number().min(0).max(100),
  coverageAmount: z.coerce.number().min(1000),
  asset: z.enum(ASSETS),
});

type QuoteInput = z.infer<typeof quoteSchema>;

interface QuoteResult {
  premium: number;
  coverage: number;
  deductible: number;
  expiresAt: string;
}

const DEFAULTS: QuoteInput = {
  policyType: 'auto',
  region: 'north',
  ageBand: '26-35',
  coverageTier: 'standard',
  safetyScore: 70,
  coverageAmount: 50000,
  asset: 'car',
};

function parseParams(params: URLSearchParams): QuoteInput {
  const parsed = quoteSchema.safeParse({
    policyType: params.get('policyType') ?? DEFAULTS.policyType,
    region: params.get('region') ?? DEFAULTS.region,
    ageBand: params.get('ageBand') ?? DEFAULTS.ageBand,
    coverageTier: params.get('coverageTier') ?? DEFAULTS.coverageTier,
    safetyScore: params.get('safetyScore') ?? DEFAULTS.safetyScore,
    coverageAmount: params.get('coverageAmount') ?? DEFAULTS.coverageAmount,
    asset: params.get('asset') ?? DEFAULTS.asset,
  });
  return parsed.success ? parsed.data : DEFAULTS;
}

function useDebounced<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function useCountdown(expiresAt: string | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt) return '';
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function QuotePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initial = useMemo(() => parseParams(new URLSearchParams(searchParams.toString())), [searchParams]);

  const {
    register,
    watch,
    formState: { errors },
  } = useForm<QuoteInput>({
    resolver: zodResolver(quoteSchema),
    defaultValues: initial,
    mode: 'onChange',
  });

  const values = watch();
  const debouncedValues = useDebounced(values, 400);

  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(debouncedValues).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [debouncedValues, router]);

  useEffect(() => {
    const parsed = quoteSchema.safeParse(debouncedValues);
    if (!parsed.success) return;

    const controller = new AbortController();
    setLoading(true);
    setQuoteError(null);

    fetch('/api/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(body?.message ?? 'Unable to fetch a quote right now.');
        }
        setQuote(body as QuoteResult);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setQuote(null);
        setQuoteError(err instanceof Error ? err.message : 'Unable to fetch a quote right now.');
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [debouncedValues]);

  const countdown = useCountdown(quote?.expiresAt ?? null);

  const continueToPurchase = () => {
    const params = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
    router.push(`/purchase?${params.toString()}`);
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Get a quote</h1>
      <p className="mt-2 text-sm text-gray-600">
        Enter your risk profile to see a live premium. Your inputs are saved in the URL so you can share this quote.
      </p>

      <form className="mt-8 grid gap-6" noValidate aria-busy={loading}>
        <Field id="policyType" label="Policy type" error={errors.policyType?.message}>
          <select id="policyType" {...register('policyType')} aria-describedby="policyType-help">
            {POLICY_TYPES.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </Field>

        <Field id="region" label="Region" error={errors.region?.message}>
          <select id="region" {...register('region')} aria-describedby="region-help">
            {REGIONS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </Field>

        <Field id="ageBand" label="Age band" error={errors.ageBand?.message}>
          <select id="ageBand" {...register('ageBand')} aria-describedby="ageBand-help">
            {AGE_BANDS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </Field>

        <Field id="coverageTier" label="Coverage tier" error={errors.coverageTier?.message}>
          <select id="coverageTier" {...register('coverageTier')} aria-describedby="coverageTier-help">
            {COVERAGE_TIERS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </Field>

        <Field id="safetyScore" label="Safety score (0-100)" error={errors.safetyScore?.message}>
          <input id="safetyScore" type="number" min={0} max={100} {...register('safetyScore')} aria-describedby="safetyScore-help" />
        </Field>

        <Field id="coverageAmount" label="Coverage amount" error={errors.coverageAmount?.message}>
          <input id="coverageAmount" type="number" min={1000} step={500} {...register('coverageAmount')} aria-describedby="coverageAmount-help" />
        </Field>

        <Field id="asset" label="Asset" error={errors.asset?.message}>
          <select id="asset" {...register('asset')} aria-describedby="asset-help">
            {ASSETS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </Field>
      </form>

      <section className="mt-8" aria-live="polite">
        {loading && <p className="text-sm text-gray-500">Fetching your quote…</p>}

        {quoteError && (
          <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {quoteError}
          </p>
        )}

        {quote && !quoteError && (
          <div className="rounded border border-gray-200 p-4">
            <h2 className="text-lg font-medium">Your quote</h2>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-gray-600">Premium</dt>
              <dd className="font-semibold">${quote.premium.toFixed(2)}</dd>
              <dt className="text-gray-600">Coverage</dt>
              <dd>${quote.coverage.toLocaleString()}</dd>
              <dt className="text-gray-600">Deductible</dt>
              <dd>${quote.deductible.toLocaleString()} (applies to each claim)</dd>
              <dt className="text-gray-600">Expires in</dt>
              <dd>{countdown}</dd>
            </dl>
            <button
              type="button"
              onClick={continueToPurchase}
              className="mt-4 rounded bg-black px-4 py-2 text-sm text-white"
            >
              Continue to purchase
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <p id={`${id}-help`} className="text-xs text-gray-500">Choose the value that best matches your profile.</p>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
