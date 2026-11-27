'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type WalletNetwork = 'public' | 'testnet' | 'futurenet';

export interface WalletAddressProps {
  address: string;
  network?: WalletNetwork;
  showCopy?: boolean;
  showExplorer?: boolean;
  className?: string;
}

const STELLAR_ADDRESS_RE = /^[GC][A-Z2-7]{55}$/;

const EXPLORER_BASE: Record<WalletNetwork, string> = {
  public: 'https://stellar.expert/explorer/public',
  testnet: 'https://stellar.expert/explorer/testnet',
  futurenet: 'https://stellar.expert/explorer/futurenet',
};

function truncate(address: string): string {
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function WalletAddress({
  address,
  network = 'testnet',
  showCopy = true,
  showExplorer = true,
  className,
}: WalletAddressProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions/insecure context) — fail silently.
    }
  }, [address]);

  if (!address) {
    return (
      <span className={className} aria-label="No wallet address">
        —
      </span>
    );
  }

  const isValid = STELLAR_ADDRESS_RE.test(address);
  const display = truncate(address);
  const explorerUrl = `${EXPLORER_BASE[network] ?? EXPLORER_BASE.testnet}/account/${address}`;

  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-sm ${className ?? ''}`}>
      <span title={address} aria-label={address} className="select-all">
        {display}
      </span>

      {showCopy && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Copied!' : `Copy address ${address}`}
          title={copied ? 'Copied!' : 'Copy address'}
          className="rounded px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      )}

      {showExplorer && isValid && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View ${address} on Stellar Expert`}
          title="View on Stellar Expert"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          ↗
        </a>
      )}
    </span>
  );
}

export default WalletAddress;
