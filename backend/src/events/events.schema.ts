/**
 * niffyInsure — Event Catalog  (schema v1)
 *
 * Mirrors contracts/niffyinsure/src/events.rs and policy.rs exactly.
 * Rules:
 *  - All token amounts: i128 stroops (string in TS to avoid float loss).
 *    1 XLM = 10_000_000 stroops (7 decimals).
 *  - All time values: ledger sequence numbers (u32).
 *    1 ledger ≈ 5 s on Stellar mainnet.
 *  - Boolean flags: u32 (0 = false, 1 = true) — matches ABI encoding.
 *  - `version` must equal SCHEMA_VERSION; reject events where it differs.
 *
 * Breaking changes (field removed / type changed) → bump SCHEMA_VERSION
 * and add a new parser entry in EVENT_PARSERS.
 * Adding optional fields is backward-compatible; no bump required.
 *
 * Topic layout (Soroban convention):
 *   topic[0] = namespace  ("niffyins" | "niffyinsure")
 *   topic[1] = event name ("clm_filed", "pol_init", …)
 *   topic[2..] = stable identifiers (claim_id, holder, …)
 */

export const SCHEMA_VERSION = 1;

// ── Namespace constants ───────────────────────────────────────────────────────

/** Namespace used by events.rs (claim / admin events). */
export const NS_CLAIM = 'niffyins';
/** Namespace used by policy.rs (#[contractevent] macro). */
export const NS_POLICY = 'niffyinsure';

// ── Claim events ──────────────────────────────────────────────────────────────

/** clm_filed — emitted by file_claim.
 *  topics: (NS_CLAIM, "clm_filed", claim_id: u64, holder: Address) */
export interface ClaimFiledEvent {
  version: number;
  /** Per-holder policy identifier (u32). */
  policy_id: number;
  /** Requested payout in stroops (i128 as string). */
  amount: string;
  /** SHA-256 digests (32 bytes each), same order as claim evidence; commitment only on-chain. */
  evidence_hashes: string[];
  /** Ledger sequence at filing time. */
  filed_at: number;
}

/** vote_cast — emitted by vote_on_claim for each ballot.
 *  topics: (NS_CLAIM, "vote_cast", claim_id: u64, voter: Address) */
export interface VoteCastEvent {
  version: number;
  vote: 'Approve' | 'Reject';
  approve_votes: number;
  reject_votes: number;
  at_ledger: number;
}

/** clm_final — emitted when voting reaches majority or deadline expires.
 *  topics: (NS_CLAIM, "clm_final", claim_id: u64) */
export interface ClaimFinalizedEvent {
  version: number;
  status: 'Approved' | 'Rejected';
  approve_votes: number;
  reject_votes: number;
  at_ledger: number;
}

/** clm_paid — emitted on successful payout transfer.
 *  topics: (NS_CLAIM, "clm_paid", claim_id: u64) */
export interface ClaimPaidEvent {
  version: number;
  /** Recipient Stellar address (G…). */
  recipient: string;
  /** Payout in stroops (i128 as string). */
  amount: string;
  /** Asset contract address (C…). */
  asset: string;
  at_ledger: number;
}

/** claim_withdrawn — emitted when claimant withdraws before any votes are cast.
 *  topics: (NS_POLICY, "claim_withdrawn", claim_id: u64) */
export interface ClaimWithdrawnEvent {
  version: number;
  /** Per-holder policy identifier (u32). */
  policy_id: number;
  /** Address of the withdrawing claimant (G…). */
  claimant: string;
  at_ledger: number;
}

// ── Policy lifecycle events ───────────────────────────────────────────────────

/** pol_init — emitted by initiate_policy.
 *  topics: (NS_POLICY, "PolicyInitiated", holder: Address) */
export interface PolicyInitiatedEvent {
  version: number;
  policy_id: number;
  /** Premium paid in stroops (i128 as string). */
  premium: string;
  /** Asset contract address (C…). */
  asset: string;
  policy_type: 'Auto' | 'Health' | 'Property';
  region: 'Low' | 'Medium' | 'High';
  /** Coverage amount in stroops (i128 as string). */
  coverage: string;
  start_ledger: number;
  end_ledger: number;
}

/** pol_renew — emitted by renew_policy.
 *  topics: (NS_POLICY, "PolicyRenewed", holder: Address) */
export interface PolicyRenewedEvent {
  version: number;
  policy_id: number;
  /** Renewal premium in stroops (i128 as string). */
  premium: string;
  new_end_ledger: number;
}

/** pol_term — emitted by terminate_policy / admin_terminate_policy.
 *  topics: (NS_POLICY, "policy_terminated", holder: Address, policy_id: u32)
 *  Note: no `version` field — this event uses #[contractevent] with explicit topics. */
export interface PolicyTerminatedEvent {
  /** Termination reason code (u32).
   *  0=None 1=VoluntaryCancellation 2=LapsedNonPayment 3=UnderwritingVoid
   *  4=FraudOrMisrepresentation 5=RegulatoryAction 6=AdminOverride */
  reason_code: number;
  /** 1 if terminated by admin, 0 if holder-initiated. */
  terminated_by_admin: number;
  /** 1 if admin bypassed open-claim guard, 0 otherwise. */
  open_claim_bypass: number;
  /** Number of open claims at termination time. */
  open_claims: number;
  at_ledger: number;
}

/** policy_expired — emitted when policy expiry is detected by keeper or renew_policy.
 *  topics: (NS_POLICY, "policy_expired", holder: Address, policy_id: u32)
 *  May be emitted with a delay; deduplicate on policy_id. */
export interface PolicyExpiredEvent {
  /** Ledger at which the policy actually expired. */
  expiry_ledger: number;
  /** Ledger when the event was emitted (may differ from expiry_ledger). */
  reported_at_ledger: number;
}

/** BeneficiaryUpdated — emitted when a holder sets or changes their payout beneficiary.
 *  topics: (NS_POLICY, "BeneficiaryUpdated", holder: Address, policy_id: u32) */
export interface BeneficiaryUpdatedEvent {
  version: number;
  /** Previous beneficiary address (G…); null if previously unset. */
  old_beneficiary: string | null;
  /** New beneficiary address (G…). */
  new_beneficiary: string;
  at_ledger: number;
}

/** GracePeriodUpdated — emitted when admin changes the renewal grace period.
 *  topics: (NS_POLICY, "GracePeriodUpdated", admin: Address) */
export interface GracePeriodUpdatedEvent {
  version: number;
  old_ledgers: number;
  new_ledgers: number;
}

// ── Admin / config events ─────────────────────────────────────────────────────

/** tbl_upd — emitted by update_multiplier_table.
 *  topics: (NS_CLAIM, "tbl_upd") */
export interface PremiumTableUpdatedEvent {
  version: number;
  table_version: number;
}

/** asset_set — emitted by set_allowed_asset.
 *  topics: (NS_CLAIM, "asset_set", asset: Address) */
export interface AssetAllowlistedEvent {
  version: number;
  /** 1 = added to allowlist, 0 = removed. */
  allowed: number;
}

/** adm_prop — emitted by propose_admin.
 *  topics: (NS_CLAIM, "adm_prop", old_admin: Address, new_admin: Address) */
export interface AdminProposedEvent {
  version: number;
}

/** adm_acc — emitted by accept_admin.
 *  topics: (NS_CLAIM, "adm_acc", old_admin: Address, new_admin: Address) */
export interface AdminAcceptedEvent {
  version: number;
}

/** adm_can — emitted by cancel_admin.
 *  topics: (NS_CLAIM, "adm_can", admin: Address, cancelled_pending: Address) */
export interface AdminCancelledEvent {
  version: number;
}

/** adm_tok — emitted by set_token.
 *  topics: (NS_CLAIM, "adm_tok") */
export interface TokenUpdatedEvent {
  version: number;
  old_token: string;
  new_token: string;
}

/** adm_paus — emitted by pause / unpause.
 *  topics: (NS_CLAIM, "adm_paus", admin: Address) */
export interface PauseToggledEvent {
  version: number;
  /** 1 = paused, 0 = unpaused. */
  paused: number;
}

/** adm_drn — emitted by drain.
 *  topics: (NS_CLAIM, "adm_drn", admin: Address) */
export interface DrainedEvent {
  version: number;
  recipient: string;
  /** Amount drained in stroops (i128 as string). */
  amount: string;
}

/** quorum_updated — emitted by admin_set_quorum_bps.
 *  topics: (NS_POLICY, "quorum_updated")
 *  Does not affect claims already in Processing. */
export interface QuorumUpdatedEvent {
  version: number;
  old_bps: number;
  new_bps: number;
}

/** GracePeriodUpdated — emitted by admin when renewal grace period changes.
 *  topics: (NS_POLICY, "GracePeriodUpdated", admin: Address) */
export interface GracePeriodUpdatedAdminEvent {
  version: number;
  old_ledgers: number;
  new_ledgers: number;
}

// ── Parser table ──────────────────────────────────────────────────────────────

/**
 * Discriminator key used by the indexer to route raw events to typed parsers.
 * Format: `${namespace}:${eventName}` — both values come from topics[0] and topics[1].
 */
export type EventKey =
  | 'niffyins:clm_filed'
  | 'niffyins:vote_cast'
  | 'niffyins:clm_final'
  | 'niffyins:clm_paid'
  | 'niffyinsure:claim_withdrawn'
  | 'niffyinsure:PolicyInitiated'
  | 'niffyinsure:PolicyRenewed'
  | 'niffyinsure:policy_terminated'
  | 'niffyinsure:policy_expired'
  | 'niffyinsure:BeneficiaryUpdated'
  | 'niffyinsure:quorum_updated'
  | 'niffyinsure:GracePeriodUpdated'
  | 'niffyins:tbl_upd'
  | 'niffyins:asset_set'
  | 'niffyins:adm_prop'
  | 'niffyins:adm_acc'
  | 'niffyins:adm_can'
  | 'niffyins:adm_tok'
  | 'niffyins:adm_paus'
  | 'niffyins:adm_drn';

export interface ParsedEvent<T> {
  key: EventKey;
  schemaVersion: number;
  /** Ledger sequence from the envelope (not the payload). */
  ledger: number;
  txHash: string;
  /** Decoded topic identifiers (claim_id, holder, …) beyond topic[0] and topic[1]. */
  ids: unknown[];
  payload: T;
}

/**
 * Versioned parser table.
 * Key = schema version; value = parse function for that version's payload shape.
 * Add a new entry here when SCHEMA_VERSION bumps; keep old entries for replay.
 */
export const EVENT_PARSERS: Record<
  EventKey,
  Record<number, (raw: unknown) => unknown>
> = {
  'niffyins:clm_filed': {
    1: (r) => r as ClaimFiledEvent,
  },
  'niffyins:vote_cast': {
    1: (r) => r as VoteCastEvent,
  },
  'niffyins:clm_final': {
    1: (r) => r as ClaimFinalizedEvent,
  },
  'niffyins:clm_paid': {
    1: (r) => r as ClaimPaidEvent,
  },
  'niffyinsure:claim_withdrawn': {
    1: (r) => r as ClaimWithdrawnEvent,
  },
  'niffyinsure:PolicyInitiated': {
    1: (r) => r as PolicyInitiatedEvent,
  },
  'niffyinsure:PolicyRenewed': {
    1: (r) => r as PolicyRenewedEvent,
  },
  'niffyinsure:policy_terminated': {
    1: (r) => r as PolicyTerminatedEvent,
  },
  'niffyinsure:policy_expired': {
    1: (r) => r as PolicyExpiredEvent,
  },
  'niffyinsure:BeneficiaryUpdated': {
    1: (r) => r as BeneficiaryUpdatedEvent,
  },
  'niffyinsure:quorum_updated': {
    1: (r) => r as QuorumUpdatedEvent,
  },
  'niffyinsure:GracePeriodUpdated': {
    1: (r) => r as GracePeriodUpdatedAdminEvent,
  },
  'niffyins:tbl_upd': {
    1: (r) => r as PremiumTableUpdatedEvent,
  },
  'niffyins:asset_set': {
    1: (r) => r as AssetAllowlistedEvent,
  },
  'niffyins:adm_prop': {
    1: (r) => r as AdminProposedEvent,
  },
  'niffyins:adm_acc': {
    1: (r) => r as AdminAcceptedEvent,
  },
  'niffyins:adm_can': {
    1: (r) => r as AdminCancelledEvent,
  },
  'niffyins:adm_tok': {
    1: (r) => r as TokenUpdatedEvent,
  },
  'niffyins:adm_paus': {
    1: (r) => r as PauseToggledEvent,
  },
  'niffyins:adm_drn': {
    1: (r) => r as DrainedEvent,
  },
};

/**
 * Parse a raw decoded event from the Soroban RPC into a typed ParsedEvent.
 * Returns null for unknown or unsupported-version events (log and skip).
 */
export function parseEvent(
  topics: unknown[],
  payload: unknown,
  ledger: number,
  txHash: string,
): ParsedEvent<unknown> | null {
  if (topics.length < 2) return null;

  const ns = String(topics[0]);
  const name = String(topics[1]);
  const key = `${ns}:${name}` as EventKey;

  const versionParsers = EVENT_PARSERS[key];
  if (!versionParsers) return null;

  const raw = payload as Record<string, unknown>;
  // PolicyTerminated has no version field; default to current schema version.
  const version = typeof raw?.version === 'number' ? raw.version : SCHEMA_VERSION;
  const parser = versionParsers[version];
  if (!parser) return null;

  return {
    key,
    schemaVersion: version,
    ledger,
    txHash,
    ids: topics.slice(2),
    payload: parser(raw),
  };
}
