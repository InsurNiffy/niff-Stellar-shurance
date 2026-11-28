'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type WalletNetwork = 'public' | 'testnet' | 'futurenet';

export interface WalletAddressProps {
  address: string;
  network?: WalletNetwork | string;
  showCopy?: boolean;
  showExplorer?: boolean;
  className?: string;
}

const STELLAR_ADDRESS_RE = /^[GC][A-Z2-7]{55}$/;

function truncate(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function normalizeNetwork(network?: string): WalletNetwork {
  const value = (network ?? 'testnet').toLowerCase();
  if (value === 'public' || value === 'mainnet') return 'public';
  if (value === 'futurenet') return 'futurenet';
  return 'testnet';
}

function explorerUrl(address: string, network: WalletNetwork): string {
  const base = 'https://stellar.expert/explorer';
  const segment = network === 'public' ? 'public' : network;
  const kind = address.startsWith('C') ? 'contract' : 'account';
  return `${base}/${segment}/${kind}/${address}`;
}

export function WalletAddress({
  address,
  network,
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
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions/insecure context) — fail silently.
    }
  }, [address]);

  const isValid = STELLAR_ADDRESS_RE.test(address);

  if (!address) {
    return (
      <span className={className} aria-label="No wallet address">
        —
      </span>
    );
  }

  if (!isValid) {
    return (
      <span
        className={className}
        title={address}
        aria-label={`Invalid Stellar address: ${address}`}
      >
        {truncate(address)}
      </span>
    );
  }

  const resolvedNetwork = normalizeNetwork(network);

  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ''}`.trim()}>
      <span
        className="font-mono text-sm"
        title={address}
        aria-label={`Stellar address ${address}`}
      >
        {truncate(address)}
      </span>

      {showCopy && (
        <button
          type="button"
          onClick={handleCopy}
          className="rounded px-1 text-xs text-muted-foreground hover:text-foreground"
          aria-label={copied ? 'Copied!' : `Copy address ${address}`}
          title={copied ? 'Copied!' : 'Copy address'}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      )}

      {showExplorer && (
        <a
          href={explorerUrl(address, resolvedNetwork)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground"
          aria-label={`View ${address} on Stellar Expert`}
          title="View on Stellar Expert"
        >
          ↗
        </a>
      )}

      {copied && (
        <span role="status" aria-live="polite" className="sr-only">
          Copied!
        </span>
      )}
    </span>
  );
}

export default WalletAddress;
