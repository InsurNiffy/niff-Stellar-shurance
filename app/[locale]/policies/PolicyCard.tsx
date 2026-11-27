'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, Check, ExternalLink } from 'lucide-react';
import type { Policy, PolicyStatus } from './types';

const STELLAR_EXPLORER_BASE: Record<string, string> = {
  public: 'https://stellar.expert/explorer/public',
  testnet: 'https://stellar.expert/explorer/testnet',
  futurenet: 'https://stellar.expert/explorer/futurenet',
};

function truncateAddress(address: string): string {
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Format a raw minor-unit token amount (bigint) into a locale-aware string.
 * Uses bigint/string arithmetic only — never JavaScript `number`.
 */
function formatTokenAmount(raw: bigint, decimals: number, locale: string): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;

  const fractionDigits = fraction === 0n
    ? ''
    : fraction.toString().padStart(decimals, '0').replace(/0+$/, '');

  const wholeFormatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(whole);

  const decimalSeparator = new Intl.NumberFormat(locale)
    .formatToParts(1.1)
    .find((part) => part.type === 'decimal')?.value ?? '.';

  const body = fractionDigits
    ? `${wholeFormatted}${decimalSeparator}${fractionDigits}`
    : wholeFormatted;

  return negative ? `-${body}` : body;
}

function formatCoverage(
  amount: bigint,
  decimals: number,
  currency: string,
  locale: string,
): string {
  return `${formatTokenAmount(amount, decimals, locale)} ${currency}`;
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

interface LedgerCountdownProps {
  targetLedger: number;
  currentLedger: number;
  avgCloseSeconds: number;
}

function formatLedgerDuration(totalSeconds: number): string {
  const totalMinutes = Math.floor(totalSeconds / 60);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  }
  return parts.join(' ');
}

function LedgerCountdown({
  targetLedger,
  currentLedger,
  avgCloseSeconds,
}: LedgerCountdownProps) {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setMounted(true);
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  if (currentLedger >= targetLedger) {
    return <span className="text-sm text-red-700">Deadline passed</span>;
  }

  if (!mounted) {
    return (
      <span className="text-sm text-gray-700">
        ~{formatLedgerDuration((targetLedger - currentLedger) * avgCloseSeconds)}
      </span>
    );
  }

  const remainingLedgers = targetLedger - currentLedger;
  const remainingSeconds = remainingLedgers * avgCloseSeconds;
  const elapsedSeconds = Math.max(0, Math.floor((now - mountedAtRef(now)) / 1000));
  const adjustedSeconds = Math.max(0, remainingSeconds - elapsedSeconds);

  return (
    <span className="text-sm text-gray-700" title="Estimated from average ledger close time">
      ~{formatLedgerDuration(adjustedSeconds)} left
    </span>
  );
}

function mountedAtRef(now: number): number {
  return now;
}

function StatusBadge({ status }: { status: PolicyStatus }) {
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
  decimals?: number;
  locale?: string;
}

export function PolicyCard({ policy, network = 'testnet', decimals, locale }: PolicyCardProps) {
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

interface PolicyTableRowProps {
  policy: Policy;
  decimals: number;
  locale: string;
}

export function PolicyTableRow({ policy, decimals, locale }: PolicyTableRowProps) {
  return (
    <tr className="hidden border-b border-gray-100 last:border-0 md:table-row">
      <td className="px-4 py-3 text-sm text-gray-900">
        <div className="font-medium">{policy.type}</div>
        <div className="text-xs text-gray-500">{policy.asset}</div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={policy.status} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-900">
        {formatCoverage(policy.coverage, decimals, policy.currency, locale)}
      </td>
      <td className="px-4 py-3">
        <ExpiryCountdown expiresAt={policy.expiresAt} />
      </td>
      <td className="px-4 py-3">
        <OpenClaimIndicator hasOpenClaim={policy.hasOpenClaim} />
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/policies/${policy.id}`}
          className="text-sm font-medium text-blue-700 hover:underline"
        >
          View
        </Link>
      </td>
    </tr>
  );
}

/**
 * Skeleton placeholder matching the shape of a loaded PolicyCard.
 * Uses the same outer <li> dimensions/padding so swapping in real content
 * does not shift layout (CLS-safe). Shimmer is disabled for users who
 * prefer reduced motion.
 */
export function PolicyCardSkeleton() {
  return (
    <li
      aria-hidden="true"
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:hidden"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="h-4 w-24 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
          <div className="h-3 w-12 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
        </div>
        <div className="h-5 w-20 animate-pulse rounded-full bg-gray-200 motion-reduce:animate-none" />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-gray-500">Coverage</dt>
          <dd className="mt-1 h-4 w-28 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
        </div>
        <div>
          <dt className="text-xs text-gray-500">Expires</dt>
          <dd className="mt-1 h-4 w-20 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
        </div>
      </dl>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="h-5 w-20 animate-pulse rounded-full bg-gray-200 motion-reduce:animate-none" />
        <div className="h-4 w-20 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
      </div>
    </li>
  );
}

/**
 * Skeleton placeholder matching the shape of a loaded PolicyTableRow.
 */
export function PolicyTableRowSkeleton() {
  return (
    <tr
      aria-hidden="true"
      className="hidden border-b border-gray-100 last:border-0 md:table-row"
    >
      <td className="px-4 py-3">
        <div className="h-4 w-24 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
        <div className="mt-1 h-3 w-12 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
      </td>
      <td className="px-4 py-3">
        <div className="h-5 w-20 animate-pulse rounded-full bg-gray-200 motion-reduce:animate-none" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-28 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-20 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
      </td>
      <td className="px-4 py-3">
        <div className="h-5 w-20 animate-pulse rounded-full bg-gray-200 motion-reduce:animate-none" />
      </td>
      <td className="px-4 py-3 text-right">
        <div className="ml-auto h-4 w-12 animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
      </td>
    </tr>
  );
}

/**
 * Empty state shown when the policies list returns zero results.
 * Includes a headline, one-sentence description, and a primary CTA.
 * The decorative illustration is aria-hidden and its subtle float
 * animation is disabled for users who prefer reduced motion.
 */
export function PoliciesEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
      <svg
        aria-hidden="true"
        viewBox="0 0 120 120"
        className="h-24 w-24 animate-[float_3s_ease-in-out_infinite] text-blue-500 motion-reduce:animate-none"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="28" y="20" width="64" height="80" rx="6" />
        <path d="M42 40h36M42 54h36M42 68h24" />
        <circle cx="88" cy="88" r="16" className="fill-white" />
        <path d="M88 80v16M80 88h16" />
      </svg>
      <h2 className="mt-4 text-lg font-semibold text-gray-900">No policies yet</h2>
      <p className="mt-1 max-w-sm text-sm text-gray-600">
        You have not purchased any coverage policies, so there is nothing to show here.
      </p>
      <Link
        href="/policies/new"
        className="mt-5 inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        Browse policies
      </Link>
    </div>
  );
}

export {
  StatusBadge,
  OpenClaimIndicator,
  ExpiryCountdown,
  LedgerCountdown,
  formatCoverage,
  formatDate,
};
