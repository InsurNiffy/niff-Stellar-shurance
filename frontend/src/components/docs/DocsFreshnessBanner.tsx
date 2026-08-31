'use client';

/**
 * DocsFreshnessBanner
 *
 * Shows a warning banner when the documentation was last updated before the
 * most recent contract deploy. Helps users know they may be reading stale docs.
 *
 * Props:
 *   lastUpdated   — ISO date string or Date of the last docs edit.
 *   lastDeployedAt — ISO date string or Date of the most recent contract deploy.
 *
 * The banner is only rendered when lastDeployedAt is strictly newer than
 * lastUpdated. If either date is missing or unparseable the banner stays hidden.
 */

import React from 'react';

export interface DocsFreshnessBannerProps {
  /** When the docs page was last edited (ISO string or Date). */
  lastUpdated: string | Date | undefined | null;
  /** When the contract was most recently deployed (ISO string or Date). */
  lastDeployedAt: string | Date | undefined | null;
}

function toDate(value: string | Date | undefined | null): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export function DocsFreshnessBanner({
  lastUpdated,
  lastDeployedAt,
}: DocsFreshnessBannerProps) {
  const updated = toDate(lastUpdated);
  const deployed = toDate(lastDeployedAt);

  // Only show if a valid deploy date exists and it is newer than the docs date.
  if (!deployed || !updated || deployed <= updated) return null;

  const deployedStr = deployed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200 mb-6"
    >
      <span className="mt-0.5 shrink-0 text-amber-500 dark:text-amber-400" aria-hidden="true">
        ⚠
      </span>
      <div>
        <strong>Documentation may be out of date.</strong>{' '}
        The contract was last deployed on{' '}
        <strong>{deployedStr}</strong>, which is newer than the most recent docs
        update. Some details (addresses, function signatures, parameters) may no
        longer be accurate. Check the{' '}
        <a
          href="/docs/contracts"
          className="underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-100"
        >
          Contract Addresses
        </a>{' '}
        page for the latest registry values.
      </div>
    </div>
  );
}
