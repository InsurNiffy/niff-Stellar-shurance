use soroban_sdk::{contracttype, Address, Map, String, Vec};

// ── Field size limits ─────────────────────────────────────────────────────────
pub const DETAILS_MAX_LEN: u32 = 256;
pub const IMAGE_URL_MAX_LEN: u32 = 128;
pub const IMAGE_URLS_MAX: u32 = 5;
pub const REASON_MAX_LEN: u32 = 128;
pub const SAFETY_SCORE_MAX: u32 = 100;

// ── Ledger window constants (re-exported from ledger.rs for ABI visibility) ───
//
// These are the canonical values used by on-chain checks.  The frontend and
// backend MUST import from here (or the generated contract spec) rather than
// hard-coding their own values.
//
// Conversion: 1 ledger ≈ 5 s on Stellar Mainnet (Protocol 20+).
// See: https://developers.stellar.org/docs/learn/fundamentals/stellar-consensus-protocol
pub use crate::ledger::{
    LEDGERS_PER_DAY, LEDGERS_PER_HOUR, LEDGERS_PER_MIN, LEDGERS_PER_WEEK,
    POLICY_DURATION_LEDGERS, QUOTE_TTL_LEDGERS, RATE_LIMIT_WINDOW_LEDGERS,
    RENEWAL_WINDOW_LEDGERS, SECS_PER_LEDGER, VOTE_WINDOW_LEDGERS,
};

// ── Enums ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum PolicyType {
    Auto,
    Health,
    Property,
}

#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum RegionTier {
    Low,
    Medium,
    High,
}

#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum AgeBand {
    Young,
    Adult,
    Senior,
}

#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum CoverageType {
    Basic,
    Standard,
    Premium,
}

/// Claim lifecycle state machine.
///
/// Transitions:
///   Processing → Approved (majority approve vote or deadline plurality)
///   Processing → Rejected (majority reject vote or deadline plurality/tie)
///   Approved   → Paid     (admin calls process_claim)
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ClaimStatus {
    Processing,
    Pending,
    Approved,
    Paid,
    Rejected,
}

impl ClaimStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(self, ClaimStatus::Approved | ClaimStatus::Paid | ClaimStatus::Rejected)
    }
}

#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum VoteOption {
    Approve,
    Reject,
}

/// Reason for policy termination.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum TerminationReason {
    None,
    VoluntaryCancellation,
    LapsedNonPayment,
    UnderwritingVoid,
    FraudOrMisrepresentation,
    RegulatoryAction,
    AdminOverride,
}

// ── Premium engine structs ────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RiskInput {
    pub region: RegionTier,
    pub age_band: AgeBand,
    pub coverage: CoverageType,
    pub safety_score: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultiplierTable {
    pub region: Map<RegionTier, i128>,
    pub age: Map<AgeBand, i128>,
    pub coverage: Map<CoverageType, i128>,
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
}

// ── Core structs ──────────────────────────────────────────────────────────────

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
    /// SEP-41 asset contract used for this policy's premium payment and claim payout.
    /// Must be allowlisted at the time of policy initiation.
    pub asset: Address,
    // Termination fields
    pub terminated_at_ledger: u32,
    pub termination_reason: TerminationReason,
    pub terminated_by_admin: bool,
}

/// On-chain claim record.
///
/// `filed_at` is the ledger sequence at which the claim was filed.  It anchors
/// the voting deadline: votes are accepted while `now < filed_at + VOTE_WINDOW_LEDGERS`.
#[contracttype]
#[derive(Clone)]
pub struct Claim {
    pub claim_id: u64,
    pub policy_id: u32,
    pub claimant: Address,
    pub amount: i128,
    pub details: String,
    pub image_urls: Vec<String>,
    pub status: ClaimStatus,
    pub voting_deadline_ledger: u32,
    pub approve_votes: u32,
    pub reject_votes: u32,
    /// Ledger sequence at which this claim was filed (voting window anchor).
    pub filed_at: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PremiumQuoteLineItem {
    pub component: String,
    pub factor: i128,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PremiumQuote {
    pub total_premium: i128,
    pub line_items: Option<Vec<PremiumQuoteLineItem>>,
    pub valid_until_ledger: u32,
    pub config_version: u32,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORACLE / PARAMETRIC TRIGGER STUBS
//
// ⚠️  LEGAL / COMPLIANCE REVIEW GATE: This module contains non-active scaffolding
// for parametric insurance automation.  Do NOT activate in production without:
//   • Completed regulatory classification review (parametric vs indemnity)
//   • Legal review of smart contract-triggered payouts
//   • Game-theoretic analysis of oracle incentivization
//   • Cryptographic design review for signature verification
//
// Compilation guarded by `#[cfg(feature = "experimental")]`.  Default builds
// are cryptographically unable to process oracle triggers (stub panics ensure
// this at compile time).
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
#[cfg(feature = "experimental")]
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
#[cfg(feature = "experimental")]
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
#[cfg(feature = "experimental")]
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
    pub payload: Vec<u8>,
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
    pub signature: Vec<u8>,
}

/// Status of an oracle trigger in the resolution pipeline.
#[cfg(feature = "experimental")]
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
#[cfg(feature = "experimental")]
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
