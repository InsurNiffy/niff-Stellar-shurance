'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Single live claim-detail component (issue #1520).
 * Renders status, amounts, description, evidence gallery with lightbox +
 * keyboard navigation, client-side SHA-256 hash verification, a status
 * explanation banner and the claim timeline.
 */

export type ClaimStatus =
  | 'filed'
  | 'voting'
  | 'approved'
  | 'rejected'
  | 'appealed'
  | 'paid';

export interface ClaimEvidence {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  /** SHA-256 hex digest recorded on-chain / at upload time. */
  hash: string;
  /** Gateway host that serves the file. */
  gateway?: string;
}

export interface ClaimTimelineEntry {
  status: ClaimStatus;
  label: string;
  timestamp?: string;
}

export interface ClaimDetailData {
  id: string;
  status: ClaimStatus;
  amount: string;
  deductible: string;
  netPayout: string;
  description: string;
  appealDeadline?: string;
  evidence: ClaimEvidence[];
  timeline: ClaimTimelineEntry[];
}

/** Gateways whose evidence may be auto-loaded. Anything else is link-only. */
export const ALLOWLISTED_GATEWAYS = [
  'ipfs.io',
  'gateway.pinata.cloud',
  'cloudflare-ipfs.com',
  'dweb.link',
];

export function isAllowlistedGateway(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ALLOWLISTED_GATEWAYS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
}

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

exnport function isPdf(mimeType: string): boolean {
  return mimeType === 'application/pdf';
}

type HashState = 'idle' | 'checking' | 'verified' | 'mismatch' | 'error';

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusBanner(claim: ClaimDetailData): { tone: string; text: string } {
  switch (claim.status) {
    case 'filed':
      return {
        tone: 'info',
        text: 'Filed — your claim is awaiting review and voting.',
      };
    case 'voting':
      return {
        tone: 'info',
        text: 'Voting in progress — reviewers are casting their votes.',
      };
    case 'approved':
      return {
        tone: 'success',
        text: 'Approved — your claim is queued for payout.',
      };
    case 'rejected':
      return {
        tone: 'danger',
        text: claim.appealDeadline
          ? `Rejected — you may appeal until ${formatDate(claim.appealDeadline)}.`
          : 'Rejected — you may appeal.',
      };
    case 'appealed':
      return {
        tone: 'warning',
        text: 'Appealed — your appeal is under review.',
      };
    case 'paid':
      return {
        tone: 'success',
        text: 'Paid — the net payout has been transferred.',
      };
    default:
      return { tone: 'info', text: 'Claim status unavailable.' };
  }
}

function HashBadge({ state }: { state: HashState }) {
  const label: Record<HashState, string> = {
    idle: 'Not verified',
    checking: 'Verifying…',
    verified: 'Verified',
    mismatch: 'Mismatch',
    error: 'Verification failed',
  };
  return (
    <span className={`hash-badge hash-badge--${state}`} data-state={state}>
      {label[state]}
    </span>
  );
}

function EvidenceItem({
  item,
  onOpen,
}: {
  item: ClaimEvidence;
  onOpen: (item: ClaimEvidence) => void;
}) {
  const [hashState, setHashState] = useState<HashState>('idle');
  const allowlisted = isAllowlistedGateway(item.url);

  const verify = useCallback(async () => {
    if (!allowlisted) return;
    setHashState('checking');
    try {
      const response = await fetch(item.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      const digest = await sha256Hex(buffer);
      setHashState(
        digest.toLowerCase() === item.hash.toLowerCase()
          ? 'verified'
          : 'mismatch',
      );
    } catch {
      setHashState('error');
    }
  }, [allowlisted, item.hash, item.url]);

  useEffect(() => {
    if (allowlisted) void verify();
  }, [allowlisted, verify]);

  return (
    <li className="evidence-item">
      {allowlisted && isImage(item.mimeType) ? (
        <button
          type="button"
          className="evidence-thumb"
          onClick={() => onOpen(item)}
          aria-label={`Open ${item.name}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.url} alt={item.name} loading="lazy" />
        </button>
      ) : (
        <a
          className="evidence-link"
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {item.name}
          {isPdf(item.mimeType) ? ' (PDF)' : ''}
        </a>
      )}
      <div className="evidence-meta">
        <span className="evidence-name">{item.name}</span>
        {allowlisted ? (
          <HashBadge state={hashState} />
        ) : (
          <span className="hash-badge hash-badge--idle" data-state="idle">
            External gateway — not auto-loaded
          </span>
        )}
      </div>
    </li>
  );
}

function Lightbox({
  items,
  index,
  onClose,
  onNavigate,
}: {
  items: ClaimEvidence[];
  index: number;
  onClose: () => void;
  onNavigate: (next: number) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const current = items[index];

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowRight') {
        onNavigate((index + 1) % items.length);
      } else if (event.key === 'ArrowLeft') {
        onNavigate((index - 1 + items.length) % items.length);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [index, items.length, onClose, onNavigate]);

  if (!current) return null;

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={current.name}
      onClick={onClose}
    >
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.url} alt={current.name} />
        <div className="lightbox-controls">
          <button
            type="button"
            onClick={() => onNavigate((index - 1 + items.length) % items.length)}
            aria-label="Previous evidence"
          >
            ‹
          </button>
          <span className="lightbox-counter">
            {index + 1} / {items.length}
          </span>
          <button
            type="button"
            onClick={() => onNavigate((index + 1) % items.length)}
            aria-label="Next evidence"
          >
            ›
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close evidence viewer"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ClaimDetail({ claim }: { claim: ClaimDetailData }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const viewable = useMemo(
    () => claim.evidence.filter((item) => isAllowlistedGateway(item.url) && isImage(item.mimeType)),
    [claim.evidence],
  );

  const banner = statusBanner(claim);

  const openEvidence = useCallback(
    (item: ClaimEvidence) => {
      const idx = viewable.findIndex((v) => v.id === item.id);
      if (idx >= 0) setLightboxIndex(idx);
    },
    [viewable],
  );

  return (
    <article className="claim-detail">
      <header className="claim-detail__header">
        <h1>Claim #{claim.id}</h1>
        <span className={`status-pill status-pill--${claim.status}`}>
          {claim.status}
        </span>
      </header>

      <div className={`status-banner status-banner--${banner.tone}`} role="status">
        {banner.text}
      </div>

      <dl className="claim-amounts">
        <div>
          <dt>Amount</dt>
          <dd>{claim.amount}</dd>
        </div>
        <div>
          <dt>Deductible</dt>
          <dd>{claim.deductible}</dd>
        </div>
        <div>
          <dt>Net payout</dt>
          <dd>{claim.netPayout}</dd>
        </div>
      </dl>

      <section className="claim-description">
        <h2>Description</h2>
        <p>{claim.description}</p>
      </section>

      <section className="claim-evidence">
        <h2>Evidence</h2>
        {claim.evidence.length === 0 ? (
          <p className="empty">No evidence attached.</p>
        ) : (
          <ul className="evidence-gallery">
            {claim.evidence.map((item) => (
              <EvidenceItem key={item.id} item={item} onOpen={openEvidence} />
            ))}
          </ul>
        )}
      </section>

      <section className="claim-timeline">
        <h2>Timeline</h2>
        <ol>
          {claim.timeline.map((entry) => (
            <li key={entry.status} className={`timeline-entry timeline-entry--${entry.status}`}>
              <span className="timeline-label">{entry.label}</span>
              <time className="timeline-time">{formatDate(entry.timestamp)}</time>
            </li>
          ))}
        </ol>
      </section>

      {lightboxIndex !== null && (
        <Lightbox
          items={viewable}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </article>
  );
}
