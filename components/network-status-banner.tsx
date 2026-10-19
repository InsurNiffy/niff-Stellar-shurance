'use client';

import { useEffect, useState } from 'react';
import { useNetworkStatus } from '@/hooks/use-network-status';

const STATUS_PAGE_URL = 'https://status.stellar.org';
const DISMISS_KEY = 'network-status-banner-dismissed';

export function NetworkStatusBanner() {
  const { status } = useNetworkStatus();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setDismissed(window.sessionStorage.getItem(DISMISS_KEY) === status);
  }, [status]);

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(DISMISS_KEY, status);
    }
  };

  if (status === 'healthy' || dismissed) return null;

  const isOffline = status === 'offline';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-between gap-4 px-4 py-2 text-sm motion-safe:transition-colors ${
        isOffline
          ? 'bg-red-600 text-white'
          : 'bg-amber-500 text-black'
      }`}
    >
      <span>
        {isOffline
          ? 'Stellar network appears offline. Some features may be unavailable.'
          : 'Stellar network is degraded. You may experience slower responses.'}{' '}
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
        onClick={handleDismiss}
        aria-label="Dismiss network status banner"
        className="shrink-0 rounded px-2 py-1 hover:bg-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
      >
        Dismiss
      </button>
    </div>
  );
}
