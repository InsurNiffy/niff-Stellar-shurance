/**
 * Optimistic UI update types.
 *
 * Optimistic state is session-only — it must not persist across page reloads.
 * On mount, components always rehydrate from the server (requirement: state
 * must not persist across page reloads).
 *
 * Maximum expected confirmation delays (documented per operation type):
 *   - Policy initiation : ~15 s  (1–3 ledger finality + indexer ingestion)
 *   - Claim filing      : ~15 s  (same as above)
 *   - Vote submission   : ~15 s  (same as above)
 *
 * Timeout before rollback: 60 s (CONFIRMATION_TIMEOUT_MS).
 */

export type OptimisticStatus = 'pending' | 'confirmed' | 'failed';

export type OptimisticOperationType = 'policy_initiation' | 'claim_filing' | 'vote_submission';

export interface OptimisticEntry<T> {
  /** Unique key identifying the resource (e.g. policy_id, claim_id). */
  key: string;
  /** Operation that produced this optimistic state. */
  operation: OptimisticOperationType;
  /** The optimistically-applied data snapshot. */
  optimisticData: T;
  /** The previous data snapshot — used for rollback. */
  previousData: T;
  status: OptimisticStatus;
  /** Epoch ms when the entry was created — used to enforce timeout. */
  createdAt: number;
  /** Transaction hash returned by the wallet, if available. */
  txHash?: string;
  /** Error message set on rollback. */
  error?: string;
}

/** How long (ms) to poll before rolling back an unconfirmed entry. */
export const CONFIRMATION_TIMEOUT_MS = 60_000;
