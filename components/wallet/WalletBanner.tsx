'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@/context/WalletContext';

/**
 * Non-blocking banner shown when no Stellar wallet extension is available
 * or when a previously stored session could not be restored (key mismatch).
 */
export default function WalletBanner() {
  const { isConnected, isExtensionAvailable, connect } = useWallet();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isConnected) {
      setDismissed(false);
    }
  }, [isConnected]);

  if (isConnected || isExtensionAvailable || dismissed) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 rounded-md border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm text-yellow-900"
    >
      <span>
        No Stellar wallet extension detected. Install Freighter, xBull, or Lobstr to
        connect your wallet.
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void connect()}
          className="rounded bg-yellow-900 px-3 py-1 text-xs font-medium text-white hover:bg-yellow-800"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss wallet notice"
          className="rounded px-2 py-1 text-xs font-medium text-yellow-900 hover:bg-yellow-100"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
