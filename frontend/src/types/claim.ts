export interface ClaimFormData {
  policyId: string;
  amount: string;
  narrative: string;
  evidenceFiles: File[];
}

export interface IpfsUploadResponse {
  cid: string;
  gatewayUrls: string[];
  filename: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}

export type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

export interface FileUploadProgress {
  file: File;
  progress: number;
  status: UploadStatus;
  error?: string;
  response?: IpfsUploadResponse;
}

// ── Chain-read types (mirrors contract types.rs) ──────────────────────────────
//
// Chain reads (via Soroban simulation) are trust-minimised: the caller verifies
// the ledger state directly without relying on the backend indexer.
//
// Differences vs indexer reads:
//   - Chain reads reflect the *current* ledger; indexer reads may lag by
//     1–3 ledgers (finality + ingestion delay, typically <15 s on Mainnet).
//   - Chain reads are always consistent with on-chain state; the indexer may
//     show stale data during re-indexing or RPC downtime.
//   - Chain reads cost simulation fees (free for read-only); indexer reads are
//     a plain HTTP GET with no on-chain cost.
//   - Use chain reads for detail views where trust matters (policy/claim pages).
//   - Use indexer reads for list views where slight lag is acceptable.

/** Mirrors contract `PolicySummary` — returned by `list_policies`. */
export interface OnChainPolicySummary {
  policy_id: number;
  /** 'Auto' | 'Health' | 'Property' */
  policy_type: string;
  coverage: bigint;
  is_active: boolean;
  end_ledger: number;
}

/** Mirrors contract `ClaimSummary` — returned by `list_claims`. */
export interface OnChainClaimSummary {
  claim_id: bigint;
  policy_id: number;
  amount: bigint;
  /** 'Processing' | 'Pending' | 'Approved' | 'Paid' | 'Rejected' | 'Withdrawn' | … */
  status: string;
  filed_at: number;
  /** Last ledger where a vote may be cast (inclusive); frozen at filing time. */
  voting_deadline_ledger: number;
}

/**
 * Mirrors contract `ClaimStatusHistoryEntry` — append-only `(status, ledger)` log
 * on the full `Claim` (also returned by `get_claim_history`). Oldest entries are
 * dropped after `CLAIM_STATUS_HISTORY_MAX` (24); use `status` for canonical state.
 */
export interface OnChainClaimStatusHistoryEntry {
  status: string;
  ledger: number;
}

/** Max items per paginated chain-read call (mirrors `PAGE_SIZE_MAX` in types.rs). */
export const CHAIN_PAGE_SIZE_MAX = 20;

