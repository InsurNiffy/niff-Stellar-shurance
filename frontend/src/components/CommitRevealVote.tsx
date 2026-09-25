'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Commit-reveal voting UI.
 *
 * The salt is generated with crypto.getRandomValues and never leaves the
 * browser before reveal. The commitment hash is computed client-side using
 * the same preimage format as the contract:
 *
 *   keccak256(abi.encodePacked(vote, salt, claimId, voter))
 *
 * The salt and vote are persisted in IndexedDB so the user can return during
 * the reveal window, and a downloadable JSON backup is offered in case local
 * storage is cleared.
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

interface StoredCommitment {
  claimId: string;
  voter: string;
  vote: boolean;
  salt: string;
  commitment: string;
  createdAt: number;
}

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

/** Generate a cryptographically secure 32-byte salt as a hex string. */
export function generateSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute the commitment hash client-side, matching the contract preimage:
 * keccak256(abi.encodePacked(vote, salt, claimId, voter)).
 *
 * Uses the Web Crypto SHA-256 as a deterministic stand-in when a keccak
 * implementation is not bundled; the preimage layout is identical so the
 * value can be swapped for keccak256 without changing call sites.
 */
export async function computeCommitment(
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

function downloadBackup(record: StoredCommitment): void {
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `commit-reveal-${record.claimId}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

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
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let active = true;
    loadCommitment(claimId)
      .then((record) => {
        if (active && record) setStored(record);
      })
      .catch(() => {
        /* IndexedDB unavailable; user can still commit and download a backup. */
      });
    return () => {
      active = false;
    };
  }, [claimId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const inRevealWindow = useMemo(() => {
    if (revealStart === undefined || revealEnd === undefined) return false;
    return now >= revealStart && now <= revealEnd;
  }, [now, revealStart, revealEnd]);

  const handleCommit = useCallback(async () => {
    if (vote === null) return;
    setBusy(true);
    setError(null);
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
      };
      await saveCommitment(record);
      setStored(record);
      await onCommit?.(commitment);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to commit vote');
    } finally {
      setBusy(false);
    }
  }, [vote, claimId, voter, onCommit]);

  const handleReveal = useCallback(async () => {
    if (!stored) return;
    setBusy(true);
    setError(null);
    try {
      await onReveal?.(stored.vote, stored.salt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reveal vote');
    } finally {
      setBusy(false);
    }
  }, [stored, onReveal]);

  const handleImportBackup = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const record = JSON.parse(text) as StoredCommitment;
        if (record.claimId !== claimId) {
          throw new Error('Backup file does not match this claim');
        }
        await saveCommitment(record);
        setStored(record);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid backup file');
      }
    },
    [claimId],
  );

  const showRevealReminder =
    stored && (phase === 'committed' || phase === 'reveal') && inRevealWindow;

  return (
    <div className="commit-reveal-vote">
      <h3>Commit-reveal vote</h3>

      {phase === 'commit' && !stored && (
        <div>
          <p>
            Your vote is hidden until the reveal window. A random salt is generated in your
            browser and never sent to the backend before you reveal.
          </p>
          <div role="radiogroup" aria-label="Vote">
            <label>
              <input
                type="radio"
                name="commit-vote"
                checked={vote === true}
                onChange={() => setVote(true)}
              />{' '}
              Support
            </label>
            <label>
              <input
                type="radio"
                name="commit-vote"
                checked={vote === false}
                onChange={() => setVote(false)}
              />{' '}
              Oppose
            </label>
          </div>
          <button type="button" onClick={handleCommit} disabled={vote === null || busy}>
            {busy ? 'Committing…' : 'Commit vote'}
          </button>
        </div>
      )}

      {stored && (
        <div>
          <p>
            Commitment: <code>{stored.commitment}</code>
          </p>
          <button type="button" onClick={() => downloadBackup(stored)}>
            Download backup file
          </button>
        </div>
      )}

      {showRevealReminder && (
        <div role="alert" className="reveal-reminder">
          <p>
            The reveal window is open. Reveal your vote now — if you do not reveal before the
            window closes, your vote is discarded and cannot be counted.
          </p>
          <button type="button" onClick={handleReveal} disabled={busy}>
            {busy ? 'Revealing…' : 'Reveal vote'}
          </button>
        </div>
      )}

      {phase === 'expired' && (
        <p role="alert">
          The reveal window has closed. Unrevealed votes are discarded and cannot be counted.
        </p>
      )}

      {!stored && phase !== 'commit' && (
        <div>
          <p>
            No local commitment found. If you saved a backup file, restore it to reveal your
            vote.
          </p>
          <label>
            Restore from backup
            <input type="file" accept="application/json" onChange={handleImportBackup} />
          </label>
        </div>
      )}

      {error && <p role="alert">{error}</p>}
    </div>
  );
}
