use soroban_sdk::{contracterror, contracttype, Address, Bytes, String, Vec};

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

/// Voting window in ledgers (~7 days at 5 s/ledger ≈ 120_960 ledgers).
/// After this many ledgers from claim filing the vote is closed and
/// finalize_claim may be called to settle the outcome.
pub const VOTE_WINDOW_LEDGERS: u32 = 120_960;

/// Maximum number of appeals allowed per claim.
/// Prevents infinite ping-pong of voting rounds.
pub const MAX_APPEALS_PER_CLAIM: u32 = 1;

/// Appeal window in ledgers (~3 days at 5 s/ledger ≈ 51_840 ledgers).
/// Claimant must open appeal within this window after rejection.
pub const APPEAL_WINDOW_LEDGERS: u32 = 51_840;

/// Appeal voting window in ledgers (~5 days at 5 s/ledger ≈ 86_400 ledgers).
/// Shorter than initial vote to expedite resolution.
pub const APPEAL_VOTE_WINDOW_LEDGERS: u32 = 86_400;

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
    AppealNotAllowed = 12,
    AppealWindowExpired = 13,
    MaxAppealsReached = 14,
    NotClaimant = 15,
    AppealNotInProgress = 16,
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

/// Claim lifecycle state machine with appeals support.
///
/// ```text
/// [filed] → Processing
///               │
///        ┌──────┴──────┐
///        ▼             ▼
///    Approved       Rejected ──┐
///                      │       │ (appeal window)
///                      ▼       │
///                 AppealOpen ◄─┘
///                      │
///               ┌──────┴──────┐
///               ▼             ▼
///          Approved    RejectedFinal
/// ```
///
/// Transitions:
///   Processing → Approved       : majority Approve votes reached
///   Processing → Rejected       : majority Reject votes reached
///   Rejected → AppealOpen       : claimant opens appeal within window
///   Rejected → RejectedFinal    : appeal window expires without appeal
///   AppealOpen → Approved       : majority Approve votes on appeal
///   AppealOpen → RejectedFinal  : majority Reject votes on appeal
///
/// Terminal states (Approved / RejectedFinal) are immutable.
/// Appeals are capped at MAX_APPEALS_PER_CLAIM to prevent infinite loops.
#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum ClaimStatus {
    Processing,
    Approved,
    Rejected,
    AppealOpen,
    RejectedFinal,
}

impl ClaimStatus {
    /// Returns true only for the terminal states.
    pub fn is_terminal(&self) -> bool {
        matches!(self, ClaimStatus::Approved | ClaimStatus::RejectedFinal)
    }

    /// Returns true if the claim is in an active voting phase.
    pub fn is_voting_active(&self) -> bool {
        matches!(self, ClaimStatus::Processing | ClaimStatus::AppealOpen)
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
/// | Field                  | Authoritative | Notes |
/// |------------------------|---------------|-------|
/// | claim_id               | on-chain      | global monotonic u64 from ClaimCounter |
/// | policy_id              | on-chain      | references Policy(holder, policy_id) |
/// | claimant               | on-chain      | must equal policy.holder |
/// | amount                 | on-chain      | stroops; 0 < amount ≤ policy.coverage |
/// | details                | on-chain      | ≤ DETAILS_MAX_LEN bytes |
/// | image_urls             | on-chain      | ≤ IMAGE_URLS_MAX items, each ≤ IMAGE_URL_MAX_LEN |
/// | status                 | on-chain      | ClaimStatus state machine |
/// | approve_votes          | on-chain      | running tally |
/// | reject_votes           | on-chain      | running tally |
/// | filed_at_ledger        | on-chain      | ledger when claim was filed |
/// | rejected_at_ledger     | on-chain      | ledger when claim was rejected (for appeal window) |
/// | appeal_count           | on-chain      | number of appeals opened (capped at MAX_APPEALS_PER_CLAIM) |
/// | appeal_opened_at_ledger| on-chain      | ledger when current appeal was opened |
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
    /// Ledger sequence when claim was filed.
    pub filed_at_ledger: u32,
    /// Ledger sequence when claim was rejected (used for appeal window).
    pub rejected_at_ledger: Option<u32>,
    /// Number of appeals opened for this claim.
    pub appeal_count: u32,
    /// Ledger sequence when current appeal was opened.
    pub appeal_opened_at_ledger: Option<u32>,
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

// ═══════════════════════════════════════════════════════════════════════════════
// ORACLE / PARAMETRIC TRIGGER TYPES
//
// ⚠️  LEGAL / COMPLIANCE REVIEW GATE: These types are scaffolding for future
// parametric insurance automation.  Do NOT activate logic in production without:
//   • Completed regulatory classification review (parametric vs indemnity)
//   • Legal review of smart contract-triggered payouts
//   • Game-theoretic analysis of oracle incentivization
//   • Cryptographic design review for signature verification
//
// Types are always compiled so that panic-stub functions in storage.rs and
// validate.rs can reference them in default (non-experimental) builds.
// Oracle logic is gated behind the `experimental` feature flag.
// ═══════════════════════════════════════════════════════════════════════════════

/// Placeholder enum for oracle data source types.
///
/// Once a cryptographic design is finalized, this will define trusted
/// attestation sources (e.g., weather APIs, flight trackers, price feeds).
///
/// CRYPTOGRAPHIC DESIGN NOTE:
/// Any signature verification scheme must be reviewed before activation.
/// Known concerns to resolve:
///   - Replay attack prevention (nonce management)
///   - Oracle key rotation mechanism
///   - Sybil resistance (how to prevent fake oracles)
///   - Collusion detection
#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum OracleSource {
    /// Stub: no trusted source defined yet.
    Undefined,
    // Future variants (examples only — NOT implemented):
    // WeatherStation(Address),
    // FlightTracker(Address),
    // PriceFeed { asset: String, threshold: i128 },
    // MultiSigOracle(Vec<Address>),
}

/// Placeholder enum for trigger event types.
///
/// These represent conditions under which parametric claims may auto-trigger.
/// Each variant should have associated validation rules defined in
/// `DESIGN-ORACLE.md` before implementation.
///
/// GAME-THEORETIC REQUIREMENTS (to be documented):
///   - How are oracles incentivized to report truthfully?
///   - What slash conditions exist for malicious reports?
///   - How is consensus achieved for ambiguous events (e.g., "storm damage")?
#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum TriggerEventType {
    /// Stub: no trigger type defined yet.
    Undefined,
    // Future variants (examples only — NOT implemented):
    // WeatherEvent { event_code: u32, threshold_value: i128 },
    // FlightCancellation { flight_id: String },
    // PriceDeviation { asset: String, deviation_bps: u32 },
    // Custom { namespace: String, predicate: Vec<u8> },
}

/// On-chain oracle trigger record.
///
/// This struct represents a signed attestation from an oracle source
/// indicating that a trigger condition has been met for a policy.
///
/// SECURITY INVARIANT (enforced by design):
///   In default (non-experimental) builds, no code path exists to accept
///   or process these records.  Experimental builds MUST complete crypto
///   review before any signature verification logic is activated.
///
/// DATA INTEGRITY NOTE:
///   The `signature` field is RESERVED for future cryptographic verification.
///   Currently it MUST be empty.  Parsing untrusted signatures without a
///   complete crypto design review is FORBIDDEN.
#[contracttype]
#[derive(Clone)]
pub struct OracleTrigger {
    /// Policy this trigger applies to.
    pub policy_id: u32,
    /// Type of trigger event.
    pub event_type: TriggerEventType,
    /// Oracle source that attested this event.
    pub source: OracleSource,
    /// Event-specific payload (schema depends on event_type).
    /// Must be validated against event_type schema before use.
    pub payload: Bytes,
    /// Unix timestamp when the oracle attested this event.
    pub timestamp: u64,
    /// Ledger sequence when this trigger was recorded.
    pub trigger_ledger: u32,
    /// Reserved for future Ed25519/EdDSA signature verification.
    ///
    /// CRITICAL SECURITY NOTE:
    /// This field MUST be empty in all current builds.  Signature
    /// verification is NOT implemented.  Any non-empty signature
    /// should be treated as INVALID until crypto review completes.
    ///
    /// DO NOT PARSE: This field may contain arbitrary data that could
    /// trigger parsing vulnerabilities if interpreted without validation.
    pub signature: Bytes,
}

/// Status of an oracle trigger in the resolution pipeline.
#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum TriggerStatus {
    /// Trigger recorded but not yet validated.
    Pending,
    /// Trigger passed all validation checks.
    Validated,
    /// Trigger rejected (invalid signature, replayed, etc.).
    Rejected,
    /// Trigger executed (payout initiated).
    Executed,
    /// Trigger expired (TTL exceeded).
    Expired,
}

/// Stub struct representing a resolved oracle-based claim.
///
/// This is a placeholder for the future parametric claim flow where
/// oracle attestations auto-generate claims without manual filing.
///
/// CLAIM GENERATION NOTE:
///   Automatic claim generation via oracle triggers requires:
///     1. Cryptographic signature verification (TBD algorithm)
///     2. Replay protection (nonce + TTL validation)
///     3. Threshold quorum for multi-oracle sources
///     4. Legal classification of auto-triggered payouts
#[contracttype]
#[derive(Clone)]
pub struct ParametricClaim {
    /// Original claim_id from the standard claims system.
    pub claim_id: u64,
    /// Trigger that caused this claim.
    pub trigger_id: u64,
    /// Amount determined by the parametric schedule.
    pub amount: i128,
    /// Status of the parametric resolution.
    pub status: TriggerStatus,
    /// Block height when resolution occurred.
    pub resolved_ledger: u32,
}
