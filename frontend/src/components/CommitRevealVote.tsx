'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HelpCircle, Download, Upload, CheckCircle2, Clock, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * CommitRevealVote — full two-phase commit-reveal voting UI. (#1670)
 *
 * Phase 1 (Commit):
 *   - User selects For / Against
 *   - A random 32-byte salt is generated client-side via crypto.getRandomValues
 *   - The commitment hash (SHA-256 of preimage) is computed and displayed
 *   - On submit: onCommit(commitment) is called; commitment + salt stored in IndexedDB
 *   - A downloadable JSON backup is offered immediately after commit
 *
 * Phase 2 (Reveal):
 *   - Stored commitment is shown
 *   - Reveal button guarded: disabled before the reveal window opens
 *   - On submit: onReveal(vote, salt) is called; IndexedDB record marked revealed
 *   - Guard notice shown when reveal window has not yet opened
 *
 * Accessibility: WCAG 2.1 AA — keyboard-navigable radio group, descriptive
 * labels, error/status live regions, min 44px touch targets, visible focus rings.
 */

export type CommitRevealPhase = 'commit' | 'committed' | 'reveal' | 'revealed' | 'expired';

export interface CommitRevealVoteProps {
  claimId: string;
  voter: string;
  phase: CommitRevealPhase;
  /** Unix seconds. Reveal window opens at this time. */
  revealStart?: number;
  /** Unix seconds. Reveal window closes at this time. */
  revealEnd?: number;
  /** Called with the commitment hash when the user commits. */
  onCommit?: (commitment: string) => Promise<void> | void;
  /** Called with the vote and salt when the user reveals. */
  onReveal?: (vote: boolean, salt: string) => Promise<void> | void;
}

// ── Types ──────────────────────────────────────────────────────────────────

interface StoredCommitment {
  claimId: string;
  voter: string;
  vote: boolean;
  salt: string;
  commitment: string;
  createdAt: number;
  revealed?: boolean;
}

// ── IndexedDB helpers ──────────────────────────────────────────────────────

const DB_NAME = 'commit-reveal-votes';
const STORE_NAME = 'commitments';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'claimId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveCommitment(record: StoredCommitment): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadCommitment(claimId: string): Promise<StoredCommitment | undefined> {
  const db = await openDb();
  const record = await new Promise<StoredCommitment | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(claimId);
    request.onsuccess = () => resolve(request.result as StoredCommitment | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return record;
}

// ── Crypto helpers ─────────────────────────────────────────────────────────

/** Generate a cryptographically secure 32-byte salt as a hex string. */
function generateSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute a commitment hash via Web Crypto SHA-256.
 * Preimage: utf8(`${vote ? '1' : '0'}${salt}${claimId}${voter}`)
 * The same layout is used by commitReveal.ts when keccak256 is unavailable.
 */
async function computeCommitment(
  vote: boolean,
  salt: string,
  claimId: string,
  voter: string,
): Promise<string> {
  const preimage = `${vote ? '1' : '0'}${salt}${claimId}${voter}`;
  const encoded = new TextEncoder().encode(preimage);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return '0x' + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Backup helpers ─────────────────────────────────────────────────────────

function downloadBackup(record: StoredCommitment): void {
  const payload = {
    version: 1,
    type: 'commit-reveal-backup',
    claimId: record.claimId,
    voter: record.voter,
    vote: record.vote,
    salt: record.salt,
    commitment: record.commitment,
    createdAt: record.createdAt,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `commit-reveal-${record.claimId}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ── Help tooltip ────────────────────────────────────────────────────────────

function HelpTooltip({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        aria-expanded={open}
        aria-label="Explain commit-reveal voting"
        className="inline-flex items-center justify-center h-6 w-6 rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        <HelpCircle className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="tooltip"
          id="commit-reveal-tooltip"
          className={cn(
            'absolute z-50 left-1/2 -translate-x-1/2 bottom-full mb-2 w-72',
            'rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-md',
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function CommitRevealVote({
  claimId,
  voter,
  phase,
  revealStart,
  revealEnd,
  onCommit,
  onReveal,
}: CommitRevealVoteProps) {
  const [vote, setVote] = useState<boolean | null>(null);
  const [stored, setStored] = useState<StoredCommitment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load any existing commitment from IndexedDB on mount
  useEffect(() => {
    let active = true;
    loadCommitment(claimId)
      .then((record) => {
        if (active && record) setStored(record);
      })
      .catch(() => {
        /* IndexedDB unavailable — user can still commit and save a backup. */
      });
    return () => { active = false; };
  }, [claimId]);

  // Tick clock every second for reveal window guard
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const inRevealWindow = useMemo(() => {
    if (revealStart === undefined || revealEnd === undefined) return false;
    return now >= revealStart && now <= revealEnd;
  }, [now, revealStart, revealEnd]);

  const revealWindowNotYetOpen = useMemo(() => {
    if (revealStart === undefined) return false;
    return now < revealStart;
  }, [now, revealStart]);

  // ── Commit handler ────────────────────────────────────────────────────────

  const handleCommit = useCallback(async () => {
    if (vote === null) return;
    setBusy(true);
    setError(null);
    setStatusMessage(null);
    try {
      const salt = generateSalt();
      const commitment = await computeCommitment(vote, salt, claimId, voter);
      const record: StoredCommitment = {
        claimId,
        voter,
        vote,
        salt,
        commitment,
        createdAt: Date.now(),
        revealed: false,
      };
      await saveCommitment(record);
      setStored(record);
      setStatusMessage('Vote committed. Download your backup file to keep the salt safe.');
      await onCommit?.(commitment);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to commit vote');
    } finally {
      setBusy(false);
    }
  }, [vote, claimId, voter, onCommit]);

  // ── Reveal handler ────────────────────────────────────────────────────────

  const handleReveal = useCallback(async () => {
    if (!stored || !inRevealWindow) return;
    setBusy(true);
    setError(null);
    setStatusMessage(null);
    try {
      await onReveal?.(stored.vote, stored.salt);
      const updated: StoredCommitment = { ...stored, revealed: true };
      await saveCommitment(updated);
      setStored(updated);
      setStatusMessage('Vote revealed successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reveal vote');
    } finally {
      setBusy(false);
    }
  }, [stored, inRevealWindow, onReveal]);

  // ── Backup import ─────────────────────────────────────────────────────────

  const handleImportBackup = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setError(null);
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as Partial<StoredCommitment> & { type?: string };
        if (parsed.claimId !== claimId) {
          throw new Error('Backup file does not match this claim');
        }
        const record: StoredCommitment = {
          claimId: parsed.claimId!,
          voter: parsed.voter ?? voter,
          vote: typeof parsed.vote === 'boolean' ? parsed.vote : false,
          salt: parsed.salt ?? '',
          commitment: parsed.commitment ?? '',
          createdAt: parsed.createdAt ?? Date.now(),
          revealed: false,
        };
        if (!record.salt || !record.commitment) {
          throw new Error('Backup file is missing salt or commitment fields');
        }
        await saveCommitment(record);
        setStored(record);
        setStatusMessage('Backup restored. You can now reveal your vote.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid backup file');
      }
      // Reset the input so the same file can be re-imported
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [claimId, voter],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const isCommitPhase = (phase === 'commit') && !stored;
  const isCommittedPhase = stored && !stored.revealed && (phase === 'committed' || phase === 'commit');
  const isRevealPhase = stored && !stored.revealed && (phase === 'reveal' || inRevealWindow);
  const isRevealed = stored?.revealed || phase === 'revealed';
  const isExpired = phase === 'expired';

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              Commit-reveal vote
              <HelpTooltip>
                <p className="font-semibold mb-1">What is commit-reveal voting?</p>
                <p className="text-xs text-muted-foreground">
                  In a commit-reveal scheme your vote is hidden from other voters until
                  a reveal window opens. First you submit a cryptographic hash
                  (commitment) of your vote and a random salt — this locks in your
                  choice without revealing it. After the reveal window opens, you
                  submit the original vote and salt to be counted. This prevents
                  voters from being influenced by how others voted.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Keep your backup file safe. If you lose it and your browser data
                  is cleared, your committed vote cannot be revealed and will be
                  discarded.
                </p>
              </HelpTooltip>
            </CardTitle>
            <CardDescription>
              Claim <span className="font-mono text-xs">{claimId}</span>
            </CardDescription>
          </div>
          {/* Phase badge */}
          <PhaseBadge phase={phase} inRevealWindow={inRevealWindow} />
        </div>
      </CardHeader>

      <CardContent className="space-y-6">

        {/* ── Phase 1: Commit ─────────────────────────────────────────── */}
        {isCommitPhase && (
          <section aria-labelledby="commit-heading">
            <h3 id="commit-heading" className="sr-only">Step 1: Commit your vote</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Your vote is hidden until the reveal window. A random salt is generated
              in your browser and never sent to the server before you reveal.
            </p>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Your vote</legend>
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
                <VoteOption
                  id="vote-for"
                  label="For"
                  description="Support this claim"
                  checked={vote === true}
                  onChange={() => setVote(true)}
                />
                <VoteOption
                  id="vote-against"
                  label="Against"
                  description="Oppose this claim"
                  checked={vote === false}
                  onChange={() => setVote(false)}
                />
              </div>
            </fieldset>

            <Button
              type="button"
              className="mt-4 w-full"
              onClick={handleCommit}
              disabled={vote === null || busy}
              aria-busy={busy}
            >
              {busy ? 'Committing…' : 'Commit vote'}
            </Button>
          </section>
        )}

        {/* ── Commitment stored ──────────────────────────────────────── */}
        {isCommittedPhase && (
          <section aria-labelledby="committed-heading" className="space-y-4">
            <h3 id="committed-heading" className="text-sm font-semibold">
              Your commitment
            </h3>
            <CommitmentDisplay commitment={stored.commitment} vote={stored.vote} />
            <p className="text-xs text-muted-foreground">
              Your vote is locked in. Download the backup file so you can reveal
              even if your browser data is cleared.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => downloadBackup(stored)}
              className="gap-2"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download backup file
            </Button>
          </section>
        )}

        {/* ── Phase 2: Reveal ────────────────────────────────────────── */}
        {isRevealPhase && (
          <section aria-labelledby="reveal-heading" className="space-y-4">
            <h3 id="reveal-heading" className="text-sm font-semibold">
              Step 2: Reveal your vote
            </h3>

            <CommitmentDisplay commitment={stored.commitment} vote={stored.vote} />

            {revealWindowNotYetOpen && (
              <div
                role="status"
                aria-live="polite"
                className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
              >
                <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>
                  The reveal window has not opened yet. You will be able to reveal
                  your vote once the reveal phase begins.
                </p>
              </div>
            )}

            {inRevealWindow && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-primary/50 bg-primary/5 p-3 text-sm"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <p>
                  The reveal window is open. Reveal your vote now — if you do not
                  reveal before the window closes, your vote is discarded and cannot
                  be counted.
                </p>
              </div>
            )}

            <Button
              type="button"
              className="w-full"
              onClick={handleReveal}
              disabled={!inRevealWindow || busy}
              aria-disabled={!inRevealWindow}
              aria-busy={busy}
              aria-describedby={revealWindowNotYetOpen ? 'reveal-window-guard' : undefined}
            >
              {busy ? 'Revealing…' : 'Reveal vote'}
            </Button>
            {revealWindowNotYetOpen && (
              <p id="reveal-window-guard" className="sr-only">
                Reveal is disabled until the reveal window opens.
              </p>
            )}
          </section>
        )}

        {/* ── Revealed ──────────────────────────────────────────────── */}
        {isRevealed && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <p>Your vote has been revealed and will be counted.</p>
          </div>
        )}

        {/* ── Expired ───────────────────────────────────────────────── */}
        {isExpired && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              The reveal window has closed. Unrevealed votes are discarded and cannot
              be counted.
            </p>
          </div>
        )}

        {/* ── No local commitment — backup restore ──────────────────── */}
        {!stored && phase !== 'commit' && !isExpired && (
          <div className="space-y-3 rounded-md border border-dashed p-4">
            <p className="text-sm text-muted-foreground">
              No local commitment found. If you saved a backup file, restore it to
              reveal your vote.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Restore from backup
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="sr-only"
              aria-label="Upload commit-reveal backup file"
              onChange={handleImportBackup}
            />
          </div>
        )}

        {/* ── Status / error live regions ───────────────────────────── */}
        {statusMessage && (
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {statusMessage}
          </p>
        )}
        {error && (
          <p role="alert" aria-live="assertive" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

interface VoteOptionProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}

function VoteOption({ id, label, description, checked, onChange }: VoteOptionProps) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex flex-1 cursor-pointer items-center gap-3 rounded-lg border p-3',
        'transition-colors hover:bg-accent',
        'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
        checked && 'border-primary bg-primary/5',
      )}
    >
      <input
        id={id}
        type="radio"
        name="commit-vote"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 accent-primary"
      />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </label>
  );
}

function CommitmentDisplay({ commitment, vote }: { commitment: string; vote: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Commitment hash
      </p>
      <p
        className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs"
        aria-label="Commitment hash"
      >
        {commitment}
      </p>
      <p className="text-xs text-muted-foreground">
        Committed vote: <span className="font-semibold">{vote ? 'For' : 'Against'}</span>
      </p>
    </div>
  );
}

function PhaseBadge({ phase, inRevealWindow }: { phase: CommitRevealPhase; inRevealWindow: boolean }) {
  const label =
    phase === 'commit' ? 'Commit phase'
    : phase === 'committed' ? 'Awaiting reveal'
    : phase === 'reveal' || inRevealWindow ? 'Reveal window open'
    : phase === 'revealed' ? 'Revealed'
    : 'Expired';

  const colour =
    phase === 'commit' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
    : phase === 'committed' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
    : phase === 'reveal' || inRevealWindow ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
    : phase === 'revealed' ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
    : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';

  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium',
        colour,
      )}
      aria-label={`Current phase: ${label}`}
    >
      {label}
    </span>
  );
}
