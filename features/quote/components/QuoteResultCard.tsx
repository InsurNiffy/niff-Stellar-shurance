'use client';

import { useEffect, useState } from 'react';

import type { Quote } from '../types';

export interface QuoteResultCardProps {
  quote: Quote;
  /** Optional callback to carry the quote inputs into the purchase flow. */
  onContinue?: (quote: Quote) => void;
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) {
    return 'Expired';
  }
  const totalSeconds = Math.floor(msRemaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Result card for a live premium quote.
 *
 * Shows the premium, coverage, deductible note and an expiry countdown, and
 * exposes a "Continue to purchase" action that carries the quote inputs into
 * the purchase flow.
 */
export function QuoteResultCard({ quote, onContinue }: QuoteResultCardProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const expiresAt = new Date(quote.expiresAt).getTime();
  const msRemaining = Number.isFinite(expiresAt) ? expiresAt - now : 0;
  const expired = msRemaining <= 0;

  return (
    <section
      aria-labelledby="quote-result-heading"
      className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
    >
      <h2 id="quote-result-heading" className="text-lg font-semibold text-gray-900">
        Your premium quote
      </h2>

      <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-gray-500">Premium</dt>
          <dd className="mt-1 text-2xl font-bold text-gray-900">
            {formatCurrency(quote.premium, quote.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-gray-500">Coverage</dt>
          <dd className="mt-1 text-2xl font-bold text-gray-900">
            {formatCurrency(quote.coverage, quote.currency)}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-sm text-gray-600" id="quote-deductible-note">
        {quote.deductibleNote}
      </p>

      <p
        className="mt-2 text-sm text-gray-600"
        role="timer"
        aria-live="polite"
        aria-atomic="true"
      >
        {expired
          ? 'This quote has expired. Refresh to get a new premium.'
          : `Quote expires in ${formatCountdown(msRemaining)}.`}
      </p>

      <button
        type="button"
        onClick={() => onContinue?.(quote)}
        disabled={expired || !onContinue}
        aria-describedby="quote-deductible-note"
        className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300 sm:w-auto"
      >
        Continue to purchase
      </button>
    </section>
  );
}

export default QuoteResultCard;
