'use client';

import { useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';

const STELLAR_EXPLORER_BASE: Record<string, string> = {
  public: 'https://stellar.expert/explorer/public',
  testnet: 'https://stellar.expert/explorer/testnet',
  futurenet: 'https://stellar.expert/explorer/futurenet',
};

function truncateAddress(address: string): string {
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function isValidStellarAddress(address: string): boolean {
  return /^[GC][A-Z2-7]{55}$/.test(address);
}

interface WalletAddressProps {
  address: string;
  network?: string;
  showCopy?: boolean;
  showExplorer?: boolean;
}

export function WalletAddress({
  address,
  network = 'testnet',
  showCopy = true,
  showExplorer = true,
}: WalletAddressProps) {
  const [copied, setCopied] = useState(false);
  const valid = isValidStellarAddress(address);

  const handleCopy = async () => {
    if (!valid) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable; fail silently.
    }
  };

  const explorerBase = STELLAR_EXPLORER_BASE[network] ?? STELLAR_EXPLORER_BASE.testnet;
  const explorerUrl = `${explorerBase}/account/${address}`;

  if (!valid) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-sm text-muted-foreground">
        <span aria-label={`Invalid address: ${address}`}>Invalid address</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 font-mono text-sm">
      <span title={address} aria-label={`Address: ${address}`}>
        {truncateAddress(address)}
      </span>
      {showCopy && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Copied!' : 'Copy address'}
          className="inline-flex items-center text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
      {copied && (
        <span role="status" className="text-xs text-green-600">
          Copied!
        </span>
      )}
      {showExplorer && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View ${address} on Stellar Expert`}
          className="inline-flex items-center text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </span>
  );
}

interface PolicyCardProps {
  policy: {
    id: string;
    name: string;
    holder: string;
    coverage: string;
    status: string;
  };
  network?: string;
}

export function PolicyCard({ policy, network = 'testnet' }: PolicyCardProps) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{policy.name}</h3>
        <span className="text-xs uppercase text-muted-foreground">{policy.status}</span>
      </div>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Holder</dt>
          <dd>
            <WalletAddress address={policy.holder} network={network} />
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Coverage</dt>
          <dd>{policy.coverage}</dd>
        </div>
      </dl>
    </div>
  );
}
