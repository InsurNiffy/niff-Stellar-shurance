'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

const ALLOWLISTED_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://arweave.net/',
];

function isAllowlisted(url: string): boolean {
  return ALLOWLISTED_GATEWAYS.some((prefix) => url.startsWith(prefix));
}

type ClaimStatus =
  | 'filed'
  | 'voting'
  | 'approved'
  | 'rejected'
  | 'appealed'
  | 'paid';

interface EvidenceItem {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  sha256?: string;
}

interface TimelineEvent {
  id: string;
  label: string;
  timestamp?: string;
  done: boolean;
}

interface Claim {
  id: string;
  status: ClaimStatus;
  amount: string;
  deductible: string;
  netPayout: string;
  description: string;
  appealDeadline?: string;
  evidence: EvidenceItem[];
  timeline: TimelineEvent[];
}

function statusBanner(claim: Claim): { tone: string; text: string } {
  switch (claim.status) {
    case 'filed':
      return { tone: 'info', text: 'Filed — awaiting voter review.' };
    case 'voting':
      return { tone: 'info', text: 'Voting in progress — results will be finalized shortly.' };
    case 'approved':
      return { tone: 'success', text: 'Approved — payout will be released after finalization.' };
    case 'rejected':
      return {
        tone: 'danger',
        text: claim.appealDeadline
          ? `Rejected — you may appeal until ${new Date(claim.appealDeadline).toLocaleString()}.`
          : 'Rejected — you may appeal.',
      };
    case 'appealed':
      return { tone: 'warning', text: 'Appealed — a new review round is underway.' };
    case 'paid':
      return { tone: 'success', text: 'Paid — the net payout has been transferred.' };
    default:
      return { tone: 'info', text: 'Status unavailable.' };
  }
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type HashState = 'idle' | 'checking' | 'verified' | 'mismatch' | 'error';

function EvidenceViewer({
  evidence,
  onClose,
  onNavigate,
}: {
  evidence: EvidenceItem;
  onClose: () => void;
  onNavigate: (delta: number) => void;
}) {
  const [hashState, setHashState] = useState<HashState>('idle');
  const [computedHash, setComputedHash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!evidence.sha256 || !isAllowlisted(evidence.url)) {
      setHashState('idle');
      return;
    }
    setHashState('checking');
    fetch(evidence.url)
      .then((res) => res.arrayBuffer())
      .then((buf) => sha256Hex(buf))
      .then((hex) => {
        if (cancelled) return;
        setComputedHash(hex);
        setHashState(hex === evidence.sha256 ? 'verified' : 'mismatch');
      })
      .catch(() => {
        if (!cancelled) setHashState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [evidence]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onNavigate(1);
      if (e.key === 'ArrowLeft') onNavigate(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onNavigate]);

  const isImage = evidence.mimeType.startsWith('image/');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Evidence viewer: ${evidence.name}`}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div className="max-h-full max-w-4xl overflow-auto" onClick={(e) => e.stopPropagation()}>
        {isImage && isAllowlisted(evidence.url) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={evidence.url} alt={evidence.name} className="max-h-[75vh] w-auto rounded" />
        ) : (
          <div className="rounded bg-white p-6 text-center text-sm text-gray-700">
            <p className="mb-2 font-medium">{evidence.name}</p>
            <a
              href={evidence.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              Open file
            </a>
          </div>
        )}
        <div className="mt-3 flex items-center justify-between text-xs text-white">
          <span>{evidence.name}</span>
          <HashBadge state={hashState} computedHash={computedHash} expected={evidence.sha256} />
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded bg-white/20 px-3 py-1 text-sm text-white"
      >
        Close (Esc)
      </button>
    </div>
  );
}

function HashBadge({
  state,
  computedHash,
  expected,
}: {
  state: HashState;
  computedHash: string | null;
  expected?: string;
}) {
  if (!expected) return <span className="text-gray-300">No hash provided</span>;
  if (state === 'checking') return <span className="text-gray-300">Verifying…</span>;
  if (state === 'verified') return <span className="text-green-400">✓ Hash verified</span>;
  if (state === 'mismatch')
    return (
      <span className="text-red-400" title={`expected ${expected} got ${computedHash}`}>
        ✗ Hash mismatch
      </span>
    );
  if (state === 'error') return <span className="text-yellow-400">Hash check failed</span>;
  return <span className="text-gray-300">Hash not checked</span>;
}

export default function ClaimDetailPage() {
  const params = useParams<{ claimId: string }>();
  const claimId = params?.claimId;
  const [claim, setClaim] = useState<Claim | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!claimId) return;
    let cancelled = false;
    fetch(`/api/claims/${claimId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load claim');
        return res.json();
      })
      .then((data: Claim) => {
        if (!cancelled) setClaim(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [claimId]);

  const navigate = useCallback(
    (delta: number) => {
      setActiveIndex((current) => {
        if (current === null || !claim) return current;
        const next = (current + delta + claim.evidence.length) % claim.evidence.length;
        return next;
      });
    },
    [claim],
  );

  const openViewer = (index: number, el: HTMLElement) => {
    lastFocused.current = el;
    setActiveIndex(index);
  };

  const closeViewer = useCallback(() => {
    setActiveIndex(null);
    lastFocused.current?.focus();
  }, []);

  const banner = useMemo(() => (claim ? statusBanner(claim) : null), [claim]);

  if (error) return <main className="p-6 text-red-600">{error}</main>;
  if (!claim) return <main className="p-6">Loading claim…</main>;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Claim {claim.id}</h1>

      {banner && (
        <div
          role="status"
          className={`mt-4 rounded border p-3 text-sm ${
            banner.tone === 'danger'
              ? 'border-red-300 bg-red-50 text-red-800'
              : banner.tone === 'success'
                ? 'border-green-300 bg-green-50 text-green-800'
                : banner.tone === 'warning'
                  ? 'border-yellow-300 bg-yellow-50 text-yellow-800'
                  : 'border-blue-300 bg-blue-50 text-blue-800'
          }`}
        >
          {banner.text}
        </div>
      )}

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-gray-500">Amount</dt>
          <dd className="font-medium">{claim.amount}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Deductible</dt>
          <dd className="font-medium">{claim.deductible}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Net payout</dt>
          <dd className="font-medium">{claim.netPayout}</dd>
        </div>
      </dl>

      <p className="mt-4 text-sm text-gray-700">{claim.description}</p>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Evidence</h2>
        {claim.evidence.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No evidence attached.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {claim.evidence.map((item, index) => {
              const isImage = item.mimeType.startsWith('image/');
              const allowed = isAllowlisted(item.url);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={(e) => openViewer(index, e.currentTarget)}
                    className="block w-full overflow-hidden rounded border text-left"
                  >
                    {isImage && allowed ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.url} alt={item.name} className="h-32 w-full object-cover" />
                    ) : (
                      <div className="flex h-32 items-center justify-center bg-gray-100 text-xs text-gray-500">
                        {isImage ? 'External image (not loaded)' : 'PDF / file'}
                      </div>
                    )}
                    <span className="block truncate p-2 text-xs">{item.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Timeline</h2>
        <ol className="mt-3 space-y-3">
          {claim.timeline.map((event) => (
            <li key={event.id} className="flex items-start gap-3 text-sm">
              <span
                aria-hidden
                className={`mt-1 h-3 w-3 flex-none rounded-full ${
                  event.done ? 'bg-green-500' : 'bg-gray-300'
                }`}
              />
              <div>
                <p className="font-medium">{event.label}</p>
                {event.timestamp && (
                  <p className="text-xs text-gray-500">
                    {new Date(event.timestamp).toLocaleString()}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {activeIndex !== null && claim.evidence[activeIndex] && (
        <EvidenceViewer
          evidence={claim.evidence[activeIndex]}
          onClose={closeViewer}
          onNavigate={navigate}
        />
      )}
    </main>
  );
}
