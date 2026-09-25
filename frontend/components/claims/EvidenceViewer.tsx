'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type EvidenceItem = {
  id: string;
  name: string;
  url: string;
  mimeType?: string;
  sha256?: string;
  gatewayAllowlisted?: boolean;
};

type HashState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'verified' }
  | { status: 'mismatch'; actual: string }
  | { status: 'error'; message: string };

function isImage(item: EvidenceItem): boolean {
  if (item.mimeType) return item.mimeType.startsWith('image/');
  return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(item.name);
}

function isPdf(item: EvidenceItem): boolean {
  if (item.mimeType) return item.mimeType === 'application/pdf';
  return /\.pdf$/i.test(item.name);
}

async function computeSha256(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch file (${res.status})`);
  const buffer = await res.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function HashBadge({ state }: { state: HashState }) {
  if (state.status === 'idle') return null;
  if (state.status === 'checking') {
    return <span className="text-xs text-gray-500">Verifying hash…</span>;
  }
  if (state.status === 'verified') {
    return (
      <span className="text-xs font-medium text-green-600" data-testid="hash-verified">
        ✓ Hash verified
      </span>
    );
  }
  if (state.status === 'mismatch') {
    return (
      <span className="text-xs font-medium text-red-600" data-testid="hash-mismatch">
        ✗ Hash mismatch
      </span>
    );
  }
  return (
    <span className="text-xs text-amber-600" data-testid="hash-error">
      Hash unavailable
    </span>
  );
}

export default function EvidenceViewer({ items }: { items: EvidenceItem[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hashStates, setHashStates] = useState<Record<string, HashState>>({});
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const images = useMemo(() => items.filter(isImage), [items]);

  const verify = useCallback(
    async (item: EvidenceItem) => {
      if (!item.sha256) return;
      if (item.gatewayAllowlisted === false) {
        setHashStates((prev) => ({
          ...prev,
          [item.id]: { status: 'error', message: 'Gateway not allowlisted' },
        }));
        return;
      }
      setHashStates((prev) => ({ ...prev, [item.id]: { status: 'checking' } }));
      try {
        const actual = await computeSha256(item.url);
        setHashStates((prev) => ({
          ...prev,
          [item.id]:
            actual.toLowerCase() === item.sha256!.toLowerCase()
              ? { status: 'verified' }
              : { status: 'mismatch', actual },
        }));
      } catch (err) {
        setHashStates((prev) => ({
          ...prev,
          [item.id]: {
            status: 'error',
            message: err instanceof Error ? err.message : 'Verification failed',
          },
        }));
      }
    },
    [],
  );

  const close = useCallback(() => setActiveIndex(null), []);

  const showPrev = useCallback(() => {
    setActiveIndex((idx) =>
      idx === null || images.length === 0 ? idx : (idx - 1 + images.length) % images.length,
    );
  }, [images.length]);

  const showNext = useCallback(() => {
    setActiveIndex((idx) =>
      idx === null || images.length === 0 ? idx : (idx + 1) % images.length,
    );
  }, [images.length]);

  useEffect(() => {
    if (activeIndex === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') showPrev();
      else if (e.key === 'ArrowRight') showNext();
    };
    window.addEventListener('keydown', onKeyDown);
    closeButtonRef.current?.focus();
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, close, showPrev, showNext]);

  if (items.length === 0) {
    return <p className="text-sm text-gray-500">No evidence submitted.</p>;
  }

  const active = activeIndex === null ? null : images[activeIndex];

  return (
    <div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((item) => {
          const imageIndex = images.findIndex((img) => img.id === item.id);
          return (
            <li key={item.id} className="rounded border border-gray-200 p-2">
              {isImage(item) ? (
                <button
                  type="button"
                  className="block w-full"
                  onClick={() => setActiveIndex(imageIndex)}
                  aria-label={`Open ${item.name}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.url}
                    alt={item.name}
                    className="h-32 w-full rounded object-cover"
                  />
                </button>
              ) : (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-32 items-center justify-center rounded bg-gray-50 text-sm text-blue-600 underline"
                >
                  {isPdf(item) ? 'PDF' : 'File'} — {item.name}
                </a>
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-gray-700">{item.name}</span>
                {item.sha256 ? (
                  <button
                    type="button"
                    className="text-xs text-blue-600 underline"
                    onClick={() => verify(item)}
                  >
                    Verify
                  </button>
                ) : null}
              </div>
              <HashBadge state={hashStates[item.id] ?? { status: 'idle' }} />
            </li>
          );
        })}
      </ul>

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={active.name}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={close}
        >
          <div className="relative max-h-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={close}
              aria-label="Close"
              className="absolute -top-10 right-0 text-2xl text-white"
            >
              ×
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={active.url} alt={active.name} className="max-h-[80vh] w-auto rounded" />
            <div className="mt-2 flex items-center justify-between text-white">
              <button type="button" onClick={showPrev} aria-label="Previous" className="px-3 py-1">
                ‹
              </button>
              <span className="text-sm">{active.name}</span>
              <button type="button" onClick={showNext} aria-label="Next" className="px-3 py-1">
                ›
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
