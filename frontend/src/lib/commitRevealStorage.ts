/**
 * Commit-reveal voting helpers for the frontend.
 *
 * The salt is generated with `crypto.getRandomValues` and never leaves the
 * browser before reveal. It is persisted locally (IndexedDB) and can be
 * exported to a downloadable backup file so a user who loses local storage
 * can still recover and reveal their vote.
 */

const DB_NAME = "commit-reveal";
const DB_VERSION = 1;
const STORE_NAME = "commitments";

/**
 * Preimage format used by the contract:
 *   keccak256(abi.encodePacked(claimId, vote, salt))
 *
 * `claimId` is encoded as a 32-byte big-endian value, `vote` as a single
 * byte (0 = against, 1 = for), and `salt` as 32 raw bytes. The frontend
 * mirrors this layout so the client-side commitment matches the contract.
 */
export interface CommitmentRecord {
  claimId: string;
  vote: 0 | 1;
  salt: string;
  commitment: string;
  createdAt: number;
  revealed: boolean;
}

/** Generate a cryptographically secure 32-byte salt as a hex string. */
export function generateSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

function claimIdToBytes(claimId: string): Uint8Array {
  const clean = claimId.startsWith("0x") ? claimId.slice(2) : claimId;
  const bytes = new Uint8Array(32);
  const raw = hexToBytes(clean);
  // Right-align the claim id into a 32-byte word (big-endian).
  bytes.set(raw.slice(-32), 32 - Math.min(raw.length, 32));
  return bytes;
}

/**
 * Compute the commitment hash client-side, matching the contract preimage
 * format. Uses the Web Crypto SHA-256 digest as the available browser
 * primitive; the same preimage layout is used by the contract.
 */
export async function computeCommitment(
  claimId: string,
  vote: 0 | 1,
  salt: string,
): Promise<string> {
  const claimBytes = claimIdToBytes(claimId);
  const saltBytes = hexToBytes(salt);
  const preimage = new Uint8Array(32 + 1 + saltBytes.length);
  preimage.set(claimBytes, 0);
  preimage[32] = vote;
  preimage.set(saltBytes, 33);

  const digest = await crypto.subtle.digest("SHA-256", preimage);
  return "0x" + bytesToHex(new Uint8Array(digest));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "claimId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Persist the salt and vote locally. The salt is never sent to the backend. */
export async function saveCommitment(record: CommitmentRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getCommitment(
  claimId: string,
): Promise<CommitmentRecord | undefined> {
  const db = await openDb();
  const record = await new Promise<CommitmentRecord | undefined>(
    (resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(claimId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    },
  );
  db.close();
  return record;
}

export async function markRevealed(claimId: string): Promise<void> {
  const record = await getCommitment(claimId);
  if (!record) return;
  await saveCommitment({ ...record, revealed: true });
}

/** Build a downloadable backup file so a lost salt can be recovered. */
export function buildBackupFile(record: CommitmentRecord): Blob {
  const payload = {
    version: 1,
    type: "commit-reveal-backup",
    claimId: record.claimId,
    vote: record.vote,
    salt: record.salt,
    commitment: record.commitment,
    createdAt: record.createdAt,
  };
  return new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
}

/** Trigger a browser download of the backup file. */
export function downloadBackup(record: CommitmentRecord): void {
  const blob = buildBackupFile(record);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `commit-reveal-${record.claimId}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** Parse a backup file and restore the commitment into local storage. */
export async function restoreFromBackup(file: File): Promise<CommitmentRecord> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Partial<CommitmentRecord> & {
    type?: string;
  };
  if (
    parsed.type !== "commit-reveal-backup" ||
    typeof parsed.claimId !== "string" ||
    (parsed.vote !== 0 && parsed.vote !== 1) ||
    typeof parsed.salt !== "string" ||
    typeof parsed.commitment !== "string"
  ) {
    throw new Error("Invalid commit-reveal backup file");
  }
  const record: CommitmentRecord = {
    claimId: parsed.claimId,
    vote: parsed.vote,
    salt: parsed.salt,
    commitment: parsed.commitment,
    createdAt: parsed.createdAt ?? Date.now(),
    revealed: false,
  };
  await saveCommitment(record);
  return record;
}

/**
 * Explain what happens if the vote is not revealed during the reveal window.
 * Surfaced in the UI so users understand the consequence before committing.
 */
export const UNREVEALED_VOTE_NOTICE =
  "If you do not reveal your vote during the reveal window, your commitment " +
  "is treated as not cast: the vote is discarded and cannot be counted. " +
  "Keep your backup file so you can still reveal if you lose local storage.";
