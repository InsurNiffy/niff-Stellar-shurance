use soroban_sdk::{contracttype, Address, Map, String, Vec};

// ── Field size limits (enforced in mutating entrypoints) ─────────────────────
//
// These constants are the single source of truth referenced by both the
// contract entrypoints and the NestJS DTO validators / Next.js form limits.
//
// Storage griefing analysis:
//   DETAILS_MAX_LEN  = 256 bytes  → ~1 ledger entry, negligible rent
//   IMAGE_URL_MAX_LEN = 128 bytes → IPFS CIDv1 base32 ≤ 62 chars; URL wrapper ≤ 128
//   IMAGE_URLS_MAX   = 5          → caps Vec<String> at 5 × 128 = 640 bytes per claim
//   REASON_MAX_LEN   = 128 bytes  → termination reason string
//   SAFETY_SCORE_MAX = 100        → bounded integer used in premium discount math

pub const DETAILS_MAX_LEN: u32 = 256;
pub const IMAGE_URL_MAX_LEN: u32 = 128;
pub const IMAGE_URLS_MAX: u32 = 5;
pub const REASON_MAX_LEN: u32 = 128;
pub const SAFETY_SCORE_MAX: u32 = 100;

// ── policy_id assignment ─────────────────────────────────────────────────────
//
// policy_id is a u32 scoped per holder: the contract increments a per-holder
// counter stored at DataKey::PolicyCounter(holder).  This means two holders
// can each have policy_id = 1 without collision; the canonical key is always
// (holder, policy_id).  A single holder may hold multiple active policies
// simultaneously; each active policy grants exactly one vote in claim
// governance (one-policy-one-vote, not one-holder-one-vote).

// ── Enums ────────────────────────────────────────────────────────────────────

/// Coverage category retained for policy lifecycle work already scoped in the
/// repository.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum PolicyType {
    Auto,
    Health,
    Property,
}

/// Geographic risk tier used by the premium multiplier table.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum RegionTier {
    Low,
    Medium,
    High,
}

/// Underwriting age buckets.  A categorical enum keeps risk math deterministic
/// and avoids ambiguous edge handling from raw ages in the contract.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum AgeBand {
    Young,
    Adult,
    Senior,
}

/// Coverage level selected for premium calculation.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum CoverageType {
    Basic,
    Standard,
    Premium,
}

/// Claim lifecycle state machine.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ClaimStatus {
    Pending,
    Approved,
    Paid,
    Rejected,
}

impl ClaimStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(self, ClaimStatus::Paid | ClaimStatus::Rejected)
    }
}

/// Ballot option cast by a policyholder during claim voting.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum VoteOption {
    Approve,
    Reject,
}

// ── Premium engine structs ───────────────────────────────────────────────────

/// Risk input accepted by the premium engine.
///
/// `safety_score` is bounded to 0..=100 at contract entry and represents the
/// percentage of the configured maximum safety discount that may be earned.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RiskInput {
    pub region: RegionTier,
    pub age_band: AgeBand,
    pub coverage: CoverageType,
    pub safety_score: u32,
}

/// Admin-configurable multiplier table.
///
/// All multiplier values use 4 decimal places of fixed precision:
/// `1.2500x == 12_500`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultiplierTable {
    pub region: Map<RegionTier, i128>,
    pub age: Map<AgeBand, i128>,
    pub coverage: Map<CoverageType, i128>,
    /// Maximum discount, scaled by 4 decimals, earned when `safety_score=100`.
    pub safety_discount: i128,
    pub version: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PremiumTableUpdated {
    pub version: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimProcessed {
    pub claim_id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub asset: Address,
}

// ── Core structs ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct Policy {
    pub holder: Address,
    pub policy_id: u32,
    pub policy_type: PolicyType,
    pub region: RegionTier,
    pub premium: i128,
    pub coverage: i128,
    pub is_active: bool,
    pub start_ledger: u32,
    pub end_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct Claim {
    pub claim_id: u64,
    pub policy_id: u32,
    pub claimant: Address,
    pub amount: i128,
    pub asset: Address,
    pub details: String,
    pub image_urls: Vec<String>,
    pub status: ClaimStatus,
    pub approve_votes: u32,
    pub reject_votes: u32,
    pub paid_at: Option<u64>,
}

/// Premium quote line item for UX display.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PremiumQuoteLineItem {
    pub component: String,
    pub factor: i128,
    pub amount: i128,
}

/// Structured quote response returned by `generate_premium`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PremiumQuote {
    pub total_premium: i128,
    pub line_items: Option<Vec<PremiumQuoteLineItem>>,
    pub valid_until_ledger: u32,
    pub config_version: u32,
}
