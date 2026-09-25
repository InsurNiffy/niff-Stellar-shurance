'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const POLICY_TYPES = ['auto', 'home', 'travel', 'health'] as const;
const REGIONS = ['north', 'south', 'east', 'west'] as const;
const AGE_BANDS = ['18-25', '26-35', '36-50', '51-65', '65+'] as const;
const COVERAGE_TIERS = ['basic', 'standard', 'premium'] as const;
const ASSETS = ['car', 'house', 'apartment', 'bike', 'none'] as const;

const MIN_COVERAGE = 1000;

const quoteSchema = z.object({
  policyType: z.enum(POLICY_TYPES, { message: 'Select a policy type' }),
  region: z.enum(REGIONS, { message: 'Select a region' }),
  ageBand: z.enum(AGE_BANDS, { message: 'Select an age band' }),
  coverageTier: z.enum(COVERAGE_TIERS, { message: 'Select a coverage tier' }),
  safetyScore: z.coerce
    .number({ message: 'Enter a safety score' })
    .min(0, 'Safety score must be between 0 and 100')
    .max(100, 'Safety score must be between 0 and 100'),
  coverageAmount: z.coerce
    .number({ message: 'Enter a coverage amount' })
    .min(MIN_COVERAGE, `Coverage must be at least ${MIN_COVERAGE}`),
  asset: z.enum(ASSETS, { message: 'Select an asset' }),
});

export type QuoteFormValues = z.infer<typeof quoteSchema>;

export interface QuoteResult {
  premium: number;
  coverage: number;
  deductibleNote: string;
  expiresAt: string;
}

interface QuoteFormProps {
  initialValues?: Partial<QuoteFormValues>;
  onQuote?: (values: QuoteFormValues) => Promise<QuoteResult>;
  onContinue?: (values: QuoteFormValues) => void;
}

const DEFAULTS: QuoteFormValues = {
  policyType: 'auto',
  region: 'north',
  ageBand: '26-35',
  coverageTier: 'standard',
  safetyScore: 70,
  coverageAmount: 5000,
  asset: 'car',
};

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function useCountdown(expiresAt?: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return '';
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function QuoteForm({ initialValues, onQuote, onContinue }: QuoteFormProps) {
  const {
    register,
    watch,
    formState: { errors },
  } = useForm<QuoteFormValues>({
    resolver: zodResolver(quoteSchema),
    defaultValues: { ...DEFAULTS, ...initialValues },
    mode: 'onChange',
  });

  const values = watch();
  const debouncedValues = useDebouncedValue(values, 400);

  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const serialized = useMemo(() => JSON.stringify(debouncedValues), [debouncedValues]);

  useEffect(() => {
    if (!onQuote) return;
    const parsed = quoteSchema.safeParse(debouncedValues);
    if (!parsed.success) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    let active = true;
    setLoading(true);
    onQuote(parsed.data)
      .then((result) => {
        if (!active) return;
        setQuote(result);
        setQuoteError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setQuote(null);
        setQuoteError(
          error instanceof Error ? error.message : 'Unable to fetch a quote right now.',
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, onQuote]);

  const countdown = useCountdown(quote?.expiresAt);

  return (
    <form
      className="quote-form"
      aria-label="Insurance quote"
      onSubmit={(event) => {
        event.preventDefault();
        if (quote && onContinue) onContinue(values);
      }}
    >
      <fieldset>
        <legend>Risk profile</legend>

        <div className="field">
          <label htmlFor="policyType">Policy type</label>
          <select id="policyType" aria-describedby="policyType-help" {...register('policyType')}>
            {POLICY_TYPES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <p id="policyType-help">The kind of policy you want to quote.</p>
          {errors.policyType && (
            <p id="policyType-error" role="alert">
              {errors.policyType.message}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="region">Region</label>
          <select id="region" aria-describedby="region-help" {...register('region')}>
            {REGIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <p id="region-help">Where the insured risk is located.</p>
          {errors.region && (
            <p id="region-error" role="alert">
              {errors.region.message}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="ageBand">Age band</label>
          <select id="ageBand" aria-describedby="ageBand-help" {...register('ageBand')}>
            {AGE_BANDS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <p id="ageBand-help">The age range of the primary policyholder.</p>
          {errors.ageBand && (
            <p id="ageBand-error" role="alert">
              {errors.ageBand.message}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="coverageTier">Coverage tier</label>
          <select id="coverageTier" aria-describedby="coverageTier-help" {...register('coverageTier')}>
            {COVERAGE_TIERS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <p id="coverageTier-help">How much protection the policy includes.</p>
          {errors.coverageTier && (
            <p id="coverageTier-error" role="alert">
              {errors.coverageTier.message}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="safetyScore">Safety score</label>
          <input
            id="safetyScore"
            type="number"
            min={0}
            max={100}
            aria-describedby="safetyScore-help"
            {...register('safetyScore')}
          />
          <p id="safetyScore-help">A score from 0 to 100 reflecting your risk profile.</p>
          {errors.safetyScore && (
            <p id="safetyScore-error" role="alert">
              {errors.safetyScore.message}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="coverageAmount">Coverage amount</label>
          <input
            id="coverageAmount"
            type="number"
            min={MIN_COVERAGE}
            aria-describedby="coverageAmount-help"
            {...register('coverageAmount')}
          />
          <p id="coverageAmount-help">The amount you want covered, in your currency.</p>
          {errors.coverageAmount && (
            <p id="coverageAmount-error" role="alert">
              {errors.coverageAmount.message}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="asset">Asset</label>
          <select id="asset" aria-describedby="asset-help" {...register('asset')}>
            {ASSETS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <p id="asset-help">The asset being insured.</p>
          {errors.asset && (
            <p id="asset-error" role="alert">
              {errors.asset.message}
            </p>
          )}
        </div>
      </fieldset>

      <section aria-live="polite" aria-label="Quote result">
        {loading && <p>Fetching your quote…</p>}
        {quoteError && (
          <p role="alert" className="quote-error">
            {quoteError}
          </p>
        )}
        {quote && !quoteError && (
          <div className="quote-result">
            <h2>Your premium</h2>
            <p className="premium">{quote.premium}</p>
            <p>Coverage: {quote.coverage}</p>
            <p>{quote.deductibleNote}</p>
            {countdown && <p>Quote expires in {countdown}</p>}
            <button type="submit" disabled={!onContinue}>
              Continue to purchase
            </button>
          </div>
        )}
      </section>
    </form>
  );
}
