use soroban_sdk::{contracterror, contracttype, Address, String, Vec};

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

pub const DETAILS_MAX_LEN: u32 = 256;
pub const IMAGE_URL_MAX_LEN: u32 = 128;
pub const IMAGE_URLS_MAX: u32 = 5;
pub const REASON_MAX_LEN: u32 = 128;

// ── policy_id assignment ─────────────────────────────────────────────────────
//
// policy_id is a u32 scoped per holder: the contract increments a per-holder
// counter stored at DataKey::PolicyCounter(holder).  This means two holders
// can each have policy_id = 1 without collision; the canonical key is always
// (holder, policy_id).  A single holder may hold multiple active policies
// simultaneously; each active policy grants exactly one vote in claim
// governance (one-policy-one-vote, not one-holder-one-vote).

// ── Error types ──────────────────────────────────────────────────────────────

/// Claim operation errors.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ClaimError {
    PolicyNotFound = 1,
    PolicyNotActive = 2,
    InvalidAmount = 3,
    AmountExceedsCoverage = 4,
    DetailsExceedMaxLength = 5,
    TooManyImageUrls = 6,
    ImageUrlExceedsMaxLength = 7,
    ClaimNotFound = 8,
    ClaimAlreadyFinalized = 9,
    VoterHasNoPolicies = 10,
    AlreadyVoted = 11,
}

// ── Enums ────────────────────────────────────────────────────────────────────

/// Coverage category.  Categorical enum prevents unbounded string storage and
/// aligns with backend DTO `PolicyType` discriminated union.
#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum PolicyType {
    Auto,
    Health,
    Property,
}

/// Geographic risk tier.  Replaces a free-form region string; maps 1-to-1 with
/// the premium multiplier table in `premium.rs`.
#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum RegionTier {
    Low,    // rural / low-risk zone
    Medium, // suburban
    High,   // urban / high-risk zone
}

/// Claim lifecycle state machine.
///
/// ```text
/// [filed] → Processing
///               │
///        ┌──────┴──────┐
///        ▼             ▼
///    Approved       Rejected
/// ```
///
/// Transitions:
///   Processing → Approved  : majority Approve votes reached
///   Processing → Rejected  : majority Reject votes reached OR policy deactivated
///
/// Terminal states (Approved / Rejected) are immutable; no re-open path exists
/// on-chain.  Off-chain dispute resolution must open a new claim.
#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum ClaimStatus {
    Processing,
    Approved,
    Rejected,
}

impl ClaimStatus {
    /// Returns true only for the two terminal states.
    pub fn is_terminal(&self) -> bool {
        matches!(self, ClaimStatus::Approved | ClaimStatus::Rejected)
    }
}

/// Ballot option cast by a policyholder during claim voting.
#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum VoteOption {
    Approve,
    Reject,
}

// ── Core structs ─────────────────────────────────────────────────────────────

/// On-chain policy record.
///
/// | Field                  | Authoritative | Notes |
/// |------------------------|---------------|-------|
/// | holder                 | on-chain      | Soroban Address; used as storage key component |
/// | policy_id              | on-chain      | per-holder u32 counter; see note above |
/// | policy_type            | on-chain      | categorical enum |
/// | region                 | on-chain      | risk tier enum |
/// | premium                | on-chain      | stroops; computed by premium.rs at bind time |
/// | coverage               | on-chain      | stroops; max payout for this policy |
/// | is_active              | on-chain      | false after termination or expiry |
/// | start_ledger           | on-chain      | ledger sequence at activation |
/// | end_ledger             | on-chain      | ledger sequence at expiry; must be > start_ledger |
/// | rejected_claims_count  | on-chain      | strike counter; incremented on claim rejection |
/// | deactivation_reason    | on-chain      | optional reason string if deactivated due to strikes |
#[contracttype]
#[derive(Clone)]
pub struct Policy {
    /// Policyholder address; component of the storage key.
    pub holder: Address,
    /// Per-holder monotonic identifier (starts at 1).
    pub policy_id: u32,
    pub policy_type: PolicyType,
    pub region: RegionTier,
    /// Annual premium in stroops paid at activation / renewal.
    pub premium: i128,
    /// Maximum claim payout in stroops; must be > 0.
    pub coverage: i128,
    pub is_active: bool,
    /// Ledger sequence when the policy became active.
    pub start_ledger: u32,
    /// Ledger sequence when the policy expires; end_ledger > start_ledger.
    pub end_ledger: u32,
    /// Number of rejected claims; used for strike-based deactivation.
    pub rejected_claims_count: u32,
    /// Reason for deactivation if policy was deactivated due to strikes.
    /// Max REASON_MAX_LEN bytes; None if policy is active or expired naturally.
    pub deactivation_reason: Option<String>,
}

/// On-chain claim record.
///
/// | Field         | Authoritative | Notes |
/// |---------------|---------------|-------|
/// | claim_id      | on-chain      | global monotonic u64 from ClaimCounter |
/// | policy_id     | on-chain      | references Policy(holder, policy_id) |
/// | claimant      | on-chain      | must equal policy.holder |
/// | amount        | on-chain      | stroops; 0 < amount ≤ policy.coverage |
/// | details       | on-chain      | ≤ DETAILS_MAX_LEN bytes |
/// | image_urls    | on-chain      | ≤ IMAGE_URLS_MAX items, each ≤ IMAGE_URL_MAX_LEN |
/// | status        | on-chain      | ClaimStatus state machine |
/// | approve_votes | on-chain      | running tally |
/// | reject_votes  | on-chain      | running tally |
#[contracttype]
#[derive(Clone)]
pub struct Claim {
    pub claim_id: u64,
    pub policy_id: u32,
    pub claimant: Address,
    /// Requested payout in stroops.
    pub amount: i128,
    /// Human-readable description; max DETAILS_MAX_LEN bytes.
    pub details: String,
    /// IPFS URLs for supporting images; max IMAGE_URLS_MAX items.
    pub image_urls: Vec<String>,
    pub status: ClaimStatus,
    pub approve_votes: u32,
    pub reject_votes: u32,
}

/// Premium quote line item for UX display.
#[contracttype]
#[derive(Clone)]
pub struct PremiumQuoteLineItem {
    pub component: String,
    pub factor: i128,
    pub amount: i128,
}

/// Structured quote response returned by `generate_premium`.
///
/// Field names and ordering are kept stable for SDK bindings consumed by
/// backend simulation services.
#[contracttype]
#[derive(Clone)]
pub struct PremiumQuote {
    pub total_premium: i128,
    pub line_items: Option<Vec<PremiumQuoteLineItem>>,
    pub valid_until_ledger: u32,
}
