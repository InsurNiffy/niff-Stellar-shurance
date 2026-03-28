//! Centralized event catalog for niffyInsure.
//!
//! # Schema versioning
//! Every event carries a `version: u32` field.  Increment `EVENT_SCHEMA_VERSION`
//! (semver-major contract release) whenever a field is removed or its type changes.
//! Adding new fields is backward-compatible and does NOT require a bump.
//!
//! # Units
//! - All token amounts: i128 stroops (1 XLM = 10_000_000 stroops, 7 decimals).
//! - All time values: ledger sequence numbers (1 ledger ≈ 5 s on mainnet).
//! - Boolean flags encoded as u32 (0 = false, 1 = true) for ABI stability.
//!
//! # Topic layout (Soroban indexer convention)
//! topic[0] = contract namespace symbol  ("niffyins")
//! topic[1] = event name symbol          ("clm_filed", "vote_cast", …)
//! topic[2..] = stable identifiers       (claim_id, holder, …)
//!
//! # Event dictionary (for frontend / data team)
//!
//! ## Claim events (namespace: "niffyins")
//!
//! ### clm_filed — ClaimFiledData
//! topics: ("niffyins", "clm_filed", claim_id: u64, holder: Address)
//! ```json
//! { "version": 1, "policy_id": 3, "amount": 5000000, "image_hash": 2864434397, "filed_at": 1234567 }
//! ```
//! - `amount`: stroops (i128)
//! - `image_hash`: FNV-1a u64 hash of concatenated IPFS CIDs
//! - `filed_at`: ledger sequence number
//!
//! ### vote_cast — VoteCastData
//! topics: ("niffyins", "vote_cast", claim_id: u64, voter: Address)
//! ```json
//! { "version": 1, "vote": "Approve", "approve_votes": 2, "reject_votes": 1, "at_ledger": 1234568 }
//! ```
//!
//! ### clm_final — ClaimFinalizedData
//! topics: ("niffyins", "clm_final", claim_id: u64)
//! ```json
//! { "version": 1, "status": "Approved", "approve_votes": 3, "reject_votes": 1, "at_ledger": 1355527 }
//! ```
//!
//! ### clm_paid — ClaimPaidData
//! topics: ("niffyins", "clm_paid", claim_id: u64)
//! ```json
//! { "version": 1, "recipient": "G...", "amount": 5000000, "asset": "C...", "at_ledger": 1355528 }
//! ```
//! - `amount`: stroops (i128)
//!
//! ### claim_withdrawn — on-chain `niffyinsure` namespace
//! Contract topics: `["niffyinsure", "claim_withdrawn", claim_id]` with payload
//! `{ policy_id, claimant, at_ledger }`. Emitted when the claimant withdraws before any vote.
//! Indexers should surface `Withdrawn` distinctly on the claims board.
//!
//! ## Admin / config events (namespace: "niffyins")
//!
//! ### tbl_upd — PremiumTableUpdatedData
//! topics: ("niffyins", "tbl_upd")
//! ```json
//! { "version": 1, "table_version": 2 }
//! ```
//!
//! ### asset_set — AssetAllowlistedData
//! topics: ("niffyins", "asset_set", asset: Address)
//! ```json
//! { "version": 1, "allowed": 1 }
//! ```
//! - `allowed`: 1 = added to allowlist, 0 = removed
//!
//! ### quorum_updated — (contract `niffyinsure` topic namespace)
//! On-chain topics: `["niffyinsure", "quorum_updated"]` with payload `{ old_bps, new_bps }`.
//! Emitted by `admin_set_quorum_bps`. Does not alter `quorum_bps` already snapshotted on open claims.
//!
//! ### adm_prop — AdminProposedData
//! topics: ("niffyins", "adm_prop", old_admin: Address, new_admin: Address)
//! ```json
//! { "version": 1 }
//! ```
//!
//! ### adm_acc — AdminAcceptedData
//! topics: ("niffyins", "adm_acc", old_admin: Address, new_admin: Address)
//! ```json
//! { "version": 1 }
//! ```
//!
//! ### adm_can — AdminCancelledData
//! topics: ("niffyins", "adm_can", admin: Address, cancelled_pending: Address)
//! ```json
//! { "version": 1 }
//! ```
//!
//! ### adm_tok — TokenUpdatedData
//! topics: ("niffyins", "adm_tok")
//! ```json
//! { "version": 1, "old_token": "C...", "new_token": "C..." }
//! ```
//!
//! ### adm_paused — PauseToggledData
//! topics: ("niffyins", "adm_paused", admin: Address)
//! ```json
//! { "version": 1, "paused": 1 }
//! ```
//! - `paused`: 1 = paused, 0 = unpaused
//!
//! ### adm_drain — DrainedData
//! topics: ("niffyins", "adm_drain", admin: Address)
//! ```json
//! { "version": 1, "recipient": "G...", "amount": 10000000 }
//! ```
//! - `amount`: stroops (i128)
//!
//! ## Policy lifecycle events
//! PolicyInitiated, PolicyRenewed, PolicyTerminated are defined in
//! policy.rs / policy_lifecycle.rs and follow the same versioning convention.
//! See those modules for field-level documentation.

use crate::types::{ClaimStatus, VoteOption};
use soroban_sdk::{contractevent, Address, Env};

/// Bump this when any event payload has a breaking change (semver-major release).
pub const EVENT_SCHEMA_VERSION: u32 = 1;

// ── Claim events ──────────────────────────────────────────────────────────────

/// Emitted by `file_claim`.
/// topics: (NS, "clm_filed", claim_id, holder)
/// payload: ClaimFiledData
#[contractevent(topics = ["niffyins", "clm_filed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimFiledData {
    #[topic]
    pub claim_id: u64,
    #[topic]
    pub holder: Address,
    pub version: u32,
    pub policy_id: u32,
    /// Amount in stroops (i128; 7 decimals).
    pub amount: i128,
    /// FNV-1a u64 hash of concatenated IPFS CIDs.
    pub image_hash: u64,
    /// Ledger sequence number at filing time.
    pub filed_at: u32,
}

pub fn emit_claim_filed(
    env: &Env,
    claim_id: u64,
    holder: &Address,
    policy_id: u32,
    amount: i128,
    image_hash: u64,
    filed_at: u32,
) {
    ClaimFiledData {
        claim_id,
        holder: holder.clone(),
        version: EVENT_SCHEMA_VERSION,
        policy_id,
        amount,
        image_hash,
        filed_at,
    }
    .publish(env);
}

/// Emitted by `vote_on_claim` for each ballot cast.
/// topics: (NS, "vote_cast", claim_id, voter)
/// payload: VoteCastData
#[contractevent(topics = ["niffyins", "vote_cast"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoteCastData {
    #[topic]
    pub claim_id: u64,
    #[topic]
    pub voter: Address,
    pub version: u32,
    pub vote: VoteOption,
    pub approve_votes: u32,
    pub reject_votes: u32,
    pub at_ledger: u32,
}

pub fn emit_vote_cast(
    env: &Env,
    claim_id: u64,
    voter: &Address,
    vote: VoteOption,
    approve_votes: u32,
    reject_votes: u32,
) {
    VoteCastData {
        claim_id,
        voter: voter.clone(),
        version: EVENT_SCHEMA_VERSION,
        vote,
        approve_votes,
        reject_votes,
        at_ledger: env.ledger().sequence(),
    }
    .publish(env);
}

/// Emitted by `finalize_claim` when the voting deadline passes.
/// topics: (NS, "clm_final", claim_id)
/// payload: ClaimFinalizedData
#[contractevent(topics = ["niffyins", "clm_final"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimFinalizedData {
    #[topic]
    pub claim_id: u64,
    pub version: u32,
    pub status: ClaimStatus,
    pub approve_votes: u32,
    pub reject_votes: u32,
    pub at_ledger: u32,
}

pub fn emit_claim_finalized(
    env: &Env,
    claim_id: u64,
    status: ClaimStatus,
    approve_votes: u32,
    reject_votes: u32,
) {
    ClaimFinalizedData {
        claim_id,
        version: EVENT_SCHEMA_VERSION,
        status,
        approve_votes,
        reject_votes,
        at_ledger: env.ledger().sequence(),
    }
    .publish(env);
}

/// Emitted by `process_claim` on successful payout.
/// topics: (NS, "clm_paid", claim_id)
/// payload: ClaimPaidData
#[contractevent(topics = ["niffyins", "clm_paid"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimPaidData {
    #[topic]
    pub claim_id: u64,
    pub version: u32,
    pub recipient: Address,
    /// Amount in stroops (i128; 7 decimals).
    pub amount: i128,
    pub asset: Address,
    pub at_ledger: u32,
}

pub fn emit_claim_paid(
    env: &Env,
    claim_id: u64,
    recipient: &Address,
    amount: i128,
    asset: &Address,
) {
    ClaimPaidData {
        claim_id,
        version: EVENT_SCHEMA_VERSION,
        recipient: recipient.clone(),
        amount,
        asset: asset.clone(),
        at_ledger: env.ledger().sequence(),
    }
    .publish(env);
}

// ── Admin / config events ─────────────────────────────────────────────────────

/// Emitted by `update_multiplier_table`.
/// topics: (NS, "tbl_upd")
/// payload: PremiumTableUpdatedData
#[contractevent(topics = ["niffyins", "tbl_upd"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PremiumTableUpdatedData {
    pub version: u32,
    pub table_version: u32,
}

pub fn emit_premium_table_updated(env: &Env, table_version: u32) {
    PremiumTableUpdatedData {
        version: EVENT_SCHEMA_VERSION,
        table_version,
    }
    .publish(env);
}

/// Emitted by `set_allowed_asset`.
/// topics: (NS, "asset_set", asset)
/// payload: AssetAllowlistedData
#[contractevent(topics = ["niffyins", "asset_set"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetAllowlistedData {
    #[topic]
    pub asset: Address,
    pub version: u32,
    /// 1 = added to allowlist, 0 = removed.
    pub allowed: u32,
}

pub fn emit_asset_allowlisted(env: &Env, asset: &Address, allowed: bool) {
    AssetAllowlistedData {
        asset: asset.clone(),
        version: EVENT_SCHEMA_VERSION,
        allowed: if allowed { 1 } else { 0 },
    }
    .publish(env);
}

// ── Admin rotation / config events ───────────────────────────────────────────

/// Emitted by `propose_admin`.
/// topics: (NS, "adm_prop", old_admin, new_admin)
#[contractevent(topics = ["niffyins", "adm_prop"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminProposedData {
    #[topic]
    pub old_admin: Address,
    #[topic]
    pub new_admin: Address,
    pub version: u32,
}

pub fn emit_admin_proposed(env: &Env, old_admin: &Address, new_admin: &Address) {
    AdminProposedData {
        old_admin: old_admin.clone(),
        new_admin: new_admin.clone(),
        version: EVENT_SCHEMA_VERSION,
    }
    .publish(env);
}

/// Emitted by `accept_admin`.
/// topics: (NS, "adm_acc", old_admin, new_admin)
#[contractevent(topics = ["niffyins", "adm_acc"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminAcceptedData {
    #[topic]
    pub old_admin: Address,
    #[topic]
    pub new_admin: Address,
    pub version: u32,
}

pub fn emit_admin_accepted(env: &Env, old_admin: &Address, new_admin: &Address) {
    AdminAcceptedData {
        old_admin: old_admin.clone(),
        new_admin: new_admin.clone(),
        version: EVENT_SCHEMA_VERSION,
    }
    .publish(env);
}

/// Emitted by `cancel_admin`.
/// topics: (NS, "adm_can", admin, cancelled_pending)
#[contractevent(topics = ["niffyins", "adm_can"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminCancelledData {
    #[topic]
    pub admin: Address,
    #[topic]
    pub cancelled_pending: Address,
    pub version: u32,
}

pub fn emit_admin_cancelled(env: &Env, admin: &Address, cancelled_pending: &Address) {
    AdminCancelledData {
        admin: admin.clone(),
        cancelled_pending: cancelled_pending.clone(),
        version: EVENT_SCHEMA_VERSION,
    }
    .publish(env);
}

/// Emitted by `set_token`.
/// topics: (NS, "adm_tok")
/// payload: TokenUpdatedData
#[contractevent(topics = ["niffyins", "adm_tok"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenUpdatedData {
    pub version: u32,
    pub old_token: Address,
    pub new_token: Address,
}

pub fn emit_token_updated(env: &Env, old_token: &Address, new_token: &Address) {
    TokenUpdatedData {
        version: EVENT_SCHEMA_VERSION,
        old_token: old_token.clone(),
        new_token: new_token.clone(),
    }
    .publish(env);
}

/// Emitted by `pause` and `unpause`.
/// topics: (NS, "adm_paus", admin)
/// payload: PauseToggledData
#[contractevent(topics = ["niffyins", "adm_paus"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PauseToggledData {
    #[topic]
    pub admin: Address,
    pub version: u32,
    /// 1 = paused, 0 = unpaused.
    pub paused: u32,
}

pub fn emit_pause_toggled(env: &Env, admin: &Address, paused: bool) {
    PauseToggledData {
        admin: admin.clone(),
        version: EVENT_SCHEMA_VERSION,
        paused: if paused { 1 } else { 0 },
    }
    .publish(env);
}

/// Emitted by `drain`.
/// topics: (NS, "adm_drn", admin)
/// payload: DrainedData
#[contractevent(topics = ["niffyins", "adm_drn"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DrainedData {
    #[topic]
    pub admin: Address,
    pub version: u32,
    pub recipient: Address,
    /// Amount in stroops (i128; 7 decimals).
    pub amount: i128,
}

pub fn emit_drained(env: &Env, admin: &Address, recipient: &Address, amount: i128) {
    DrainedData {
        admin: admin.clone(),
        version: EVENT_SCHEMA_VERSION,
        recipient: recipient.clone(),
        amount,
    }
    .publish(env);
}
