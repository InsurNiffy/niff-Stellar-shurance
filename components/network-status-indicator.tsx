'use client';

import { useEffect, useState } from 'react';
import { useNetworkStatus } from '@/hooks/use-network-status';

const STATUS_PAGE_URL = 'https://status.stellar.org';

const STATUS_STYLES: Record<string, string> = {
  healthy: 'bg-green-100 text-green-800 border-green-300',
  degraded: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  offline: 'bg-red-100 text-red-800 border-red-300',
};

const STATUS_LABELS: Record<string, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  offline: 'Offline',
};

const STATUS_DOT: Record<string, string> = {
  healthy: 'bg-green-500',
  degraded: 'bg-yellow-500',
  offline: 'bg-red-500',
};

export function NetworkStatusIndicator() {
  const { status } = useNetworkStatus();
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Re-show the banner whenever the status changes to a non-healthy state.
  useEffect(() => {
    if (status === 'healthy') {
      setBannerDismissed(false);
    }
  }, [status]);

  const showBanner = status !== 'healthy' && !bannerDismissed;

  return (
    <>
      <span
        role="status"
        aria-live="polite"
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
      >
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full motion-safe:animate-pulse ${STATUS_DOT[status]}`}
        />
        {STATUS_LABELS[status]}
      </span>

      {showBanner && (
        <div
          role="alert"
          className={`flex items-center justify-between gap-3 border-b px-4 py-2 text-sm ${STATUS_STYLES[status]}`}
        >
          <span>
            Stellar network is currently{' '}
            <strong>{STATUS_LABELS[status].toLowerCase()}</strong>.{' '}
            <a
              href={STATUS_PAGE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              View status page
            </a>
          </span>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss network status banner"
            className="rounded p-1 hover:bg-black/5 motion-safe:transition-colors"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
    </>
  );
}

export default NetworkStatusIndicator;
