use soroban_sdk::{contractevent, contracttype, Address, Bytes, BytesN, Map, String, Vec};

// ── Field size limits ─────────────────────────────────────────────────────────
pub const DETAILS_MAX_LEN: u32 = 256;
pub const IMAGE_URL_MAX_LEN: u32 = 128;
/// Max evidence attachments per claim (URL + SHA-256 commitment each).
pub const IMAGE_URLS_MAX: u32 = 5;
pub const REASON_MAX_LEN: u32 = 128;
pub const SAFETY_SCORE_MAX: u32 = 100;

// ── Rejection side-effect thresholds ─────────────────────────────────────────
//
// GOVERNANCE NOTE: This constant is the only on-chain parameter controlling
// automatic policy deactivation. Changing it requires a contract upgrade and
// cannot be altered by the admin at runtime — removing an avenue for
// admin-only extraction via strike-count manipulation.
//
// LEGAL NOTE: Product/legal must sign off on the strike threshold before
// mainnet deployment. Three rejections is a conservative starting point.
// The threshold intentionally errs toward coverage preservation; false
// positives (legitimate holders de-activated) are harder to recover from
// than false negatives (fraudulent holders retained until human review).
//
// APPEAL INTERACTION: If an appeal window is added later, auto-deactivation
// should be deferred until the appeal deadline passes. Implement by adding a
// `deactivation_pending_until_ledger: u32` field to Policy and skipping the
// `is_active = false` write until that ledger is reached.

// ── Ledger window constants (re-exported from ledger.rs for ABI visibility) ───
//
// These are the canonical values used by on-chain checks.  The frontend and
// backend MUST import from here (or the generated contract spec) rather than
// hard-coding their own values.
//
// Conversion: 1 ledger ≈ 5 s on Stellar Mainnet (Protocol 20+).
// See: https://developers.stellar.org/docs/learn/fundamentals/stellar-consensus-protocol
pub use crate::ledger::{
    APPEAL_OPEN_WINDOW_LEDGERS, APPEAL_VOTE_WINDOW_LEDGERS, DEFAULT_GRACE_PERIOD_LEDGERS,
    LEDGERS_PER_DAY, LEDGERS_PER_HOUR, LEDGERS_PER_MIN, LEDGERS_PER_WEEK, MAX_APPEALS_PER_CLAIM,
    MAX_GRACE_PERIOD_LEDGERS, MAX_VOTING_DURATION_LEDGERS, MIN_GRACE_PERIOD_LEDGERS,
    MIN_VOTING_DURATION_LEDGERS, POLICY_DURATION_LEDGERS, QUOTE_TTL_LEDGERS,
    RATE_LIMIT_WINDOW_LEDGERS, RENEWAL_WINDOW_LEDGERS, SECS_PER_LEDGER, VOTE_WINDOW_LEDGERS,
};

// ── Strike / rejection constants ──────────────────────────────────────────────

/// Number of rejected claims that automatically deactivates a policy.
///
/// This is a **compile-time constant**, not a runtime admin parameter.  Admin
/// cannot flip it post-deployment, which prevents governance gaming where a
/// large voter bloc rejects claims to deactivate rival policies.
///
/// **Legal review:** Before changing this value, consult legal counsel on
/// whether automatic policy cancellation triggers regulatory requirements
/// (e.g., notice periods, appeal rights).
///
/// **Appeal interaction:** Deactivation triggered by reaching this threshold
/// can be reversed by a successful appeal that decrements strikes back below it.
pub const STRIKE_DEACTIVATION_THRESHOLD: u32 = 3;

// ── Claim voting quorum (basis points) ────────────────────────────────────────

/// Default participation quorum when instance `QuorumBps` is unset, and fallback for
/// claims filed before per-claim quorum snapshots existed.
pub const DEFAULT_QUORUM_BPS: u32 = 5000;

/// Admin `quorum_bps` must satisfy `QUORUM_BPS_MIN <= quorum_bps <= QUORUM_BPS_MAX`.
pub const QUORUM_BPS_MIN: u32 = 1;
pub const QUORUM_BPS_MAX: u32 = 10_000;

/// One full turn-out / 100% weight in bps (used in the quorum formula below).
pub const QUORUM_BPS_DENOMINATOR: u32 = 10_000;

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
pub enum CoverageTier {
    Basic,
    Standard,
    Premium,
}

/// Alias for [`CoverageTier`] used in the renewal entrypoint and legacy test helpers.
/// Both names refer to the same on-chain enum; prefer `CoverageTier` in new code.
pub type CoverageType = CoverageTier;
///
/// Base-flow transitions:
///   Processing  → Approved      (participation quorum met + more approve than reject votes cast)
///   Processing  → Rejected      (participation quorum met + reject wins or tie; or deadline with no quorum)
///   Processing  → Withdrawn     (claimant calls `withdraw_claim` before any vote is cast)
///   Approved    → Paid          (admin calls process_claim)
///
/// Appeal-flow transitions (requires Rejected status + open appeal window):
///   Rejected    → UnderAppeal   (claimant calls open_appeal within window)
///   UnderAppeal → AppealApproved (majority approve appeal vote or deadline)
///   UnderAppeal → AppealRejected (majority reject appeal vote or deadline)
///   AppealApproved → Paid       (admin calls process_claim — same as Approved)
///
/// Terminal states (no further transitions): Paid, Rejected (after appeal window
/// closes), AppealApproved (→ Paid only), AppealRejected, Withdrawn.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ClaimStatus {
    Processing,
    Pending,
    Approved,
    Paid,
    Rejected,
    /// Claimant has opened an appeal; fresh vote round in progress.
    UnderAppeal,
    /// Appeal vote resolved in claimant's favour; awaits admin payout.
    AppealApproved,
    /// Appeal vote rejected; claim is permanently closed.
    AppealRejected,
    /// Claimant withdrew before voting began; record kept for audit; no payout.
    Withdrawn,
}

impl ClaimStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            ClaimStatus::Approved
                | ClaimStatus::Paid
                | ClaimStatus::Rejected
                | ClaimStatus::AppealApproved
                | ClaimStatus::AppealRejected
                | ClaimStatus::Withdrawn
        )
    }
}

/// One step in a claim's on-chain status timeline.
///
/// `ledger` is the Stellar ledger sequence when the claim entered `status`.
/// Persisted on the claim so Next.js timelines can render the lifecycle without
/// depending only on indexer events (which may be incomplete during reindex).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimStatusHistoryEntry {
    pub status: ClaimStatus,
    pub ledger: u32,
}

/// Maximum `(status, ledger)` pairs retained per claim.
///
/// When a new transition would exceed this, the **oldest** entry is dropped
/// (FIFO) so claim storage cannot grow without bound (anti-griefing).
///
/// Sized above the documented main flow plus appeal rounds (`MAX_APPEALS_PER_CLAIM`
/// in `ledger.rs`). If more transitions occur than this (e.g. future protocol
/// changes), **`status_history` may omit early steps** — `status` remains canonical.
pub const CLAIM_STATUS_HISTORY_MAX: u32 = 24;

#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum VoteOption {
    Approve,
    Reject,
}

/// Reason for policy termination.
///
/// GOVERNANCE NOTE: `ExcessiveRejections` is set by the claims engine
/// automatically when `strike_count` reaches `STRIKE_DEACTIVATION_THRESHOLD`.
/// All other variants require an explicit holder or admin action.
///
/// CENTRALIZATION RISK: `AdminOverride` allows the admin to terminate any
/// policy for any reason at any time. This is a privileged operation that
/// bypasses normal holder protections. Consider a time-lock or multi-sig
/// requirement before using this variant in production.
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
    /// Automatically set when `Policy.strike_count` reaches
    /// `STRIKE_DEACTIVATION_THRESHOLD` consecutive rejections.
    /// No admin intervention is required or possible to prevent this;
    /// the transition is deterministic and trustless.
    ///
    /// APPEAL NOTE: If an appeal window is introduced, deactivation should be
    /// deferred until the appeal window closes. The `PolicyDeactivated` event
    /// (emitted in `claim.rs`) is the authoritative signal for indexers; it
    /// will carry a `reason_code = 1` identifying this variant.
    ExcessiveRejections,
}

// ── Pagination ────────────────────────────────────────────────────────────────

/// Hard cap on items returned per paginated call.
///
/// Soroban charges per-entry read fees; returning more than this in a single
/// simulation would blow the default instruction budget.  Callers requesting
/// a larger `limit` receive exactly `PAGE_SIZE_MAX` items — never an error.
///
/// Ordering: policies are returned in ascending `policy_id` order; claims in
/// ascending `claim_id` order.  Both orderings are stable across calls as long
/// as no items are deleted (items are never deleted in this contract).
///
/// Stale-cursor note: cursors are plain integer offsets (policy_id / claim_id).
/// If the underlying counter has not changed between pages, the cursor is safe.
/// Because IDs are monotonically increasing and records are never deleted,
/// a cursor pointing past the last item simply returns an empty page — it
/// never panics or skips records.
pub const PAGE_SIZE_MAX: u32 = 20;

/// Maximum `(holder, policy_id)` pairs in a single `get_policies_batch` call.
///
/// Intentionally equals [`PAGE_SIZE_MAX`]: each lookup is a separate storage read, so
/// allowing unbounded batches would risk instruction-meter exhaustion during RPC
/// simulation and unfair resource use. Unlike `list_policies` (which silently clamps
/// `limit`), an over-cap batch **reverts** so callers chunk explicitly.
pub const POLICY_BATCH_GET_MAX: u32 = PAGE_SIZE_MAX;

/// Key for batched policy reads (`get_policies_batch`).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolicyLookupKey {
    pub holder: Address,
    pub policy_id: u32,
}

/// Lightweight policy summary returned by `list_policies`.
///
/// Omits large or rarely-needed fields (`details`, `evidence`, etc.) to keep
/// per-page byte cost predictable.  Callers that need the full record should
/// follow up with `get_policy(holder, policy_id)`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolicySummary {
    pub policy_id: u32,
    pub policy_type: PolicyType,
    pub coverage: i128,
    pub is_active: bool,
    pub end_ledger: u32,
}

/// Lightweight claim summary returned by `list_claims`.
///
/// Omits `details` and `evidence` to keep per-page byte cost predictable.
/// Callers that need the full record should follow up with `get_claim(claim_id)`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimSummary {
    pub claim_id: u64,
    pub policy_id: u32,
    pub amount: i128,
    /// Deductible snapshot (from filing); net payout is not stored here — see payout events.
    pub deductible: i128,
    pub status: ClaimStatus,
    pub filed_at: u32,
    /// Same field as `Claim::voting_deadline_ledger` — authoritative for UI / indexers.
    pub voting_deadline_ledger: u32,
}

// ── Claim evidence ───────────────────────────────────────────────────────────

/// One evidence attachment: where to fetch bytes off-chain and a **SHA-256 content hash**
/// the submitter asserts matches those bytes at filing time.
///
/// # On-chain limitation
///
/// This contract **does not** fetch `url` or recompute SHA-256 on-chain. It only stores
/// the commitment. Off-chain services (NestJS IPFS proxy, verification workers) must
/// download content and compare digests to `hash` for integrity.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimEvidenceEntry {
    pub url: String,
    /// SHA-256 digest (32 bytes). Filing rejects the all-zero digest.
    pub hash: BytesN<32>,
}

// ── Premium engine structs ────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RiskInput {
    pub region: RegionTier,
    pub age_band: AgeBand,
    pub coverage: CoverageTier,
    pub safety_score: u32,
}

/// Bundles the optional/extra fields for `initiate_policy` to stay within
/// Soroban's 10-parameter ABI limit. All fields are optional in MVP.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InitiatePolicyOptions {
    pub beneficiary: Option<Address>,
    pub deductible: Option<i128>,
    /// Opt-in replay-protection nonce. Pass `None` to skip the check.
    /// Supplementary to Stellar sequence numbers — not a replacement.
    pub expected_nonce: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultiplierTable {
    pub region: Map<RegionTier, i128>,
    pub age: Map<AgeBand, i128>,
    pub coverage: Map<CoverageTier, i128>,
    pub safety_discount: i128,
    pub version: u32,
}

#[contractevent(topics = ["niffyinsure", "premium_table_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PremiumTableUpdated {
    pub version: u32,
}

#[contractevent(topics = ["niffyinsure", "claim_paid"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimProcessed {
    #[topic]
    pub claim_id: u64,
    pub recipient: Address,
    /// Gross approved claim amount (before deductible), same units as policy asset.
    pub gross_amount: i128,
    /// Policy deductible applied at payout (snapshot from claim record).
    pub deductible: i128,
    /// Net token transfer: `gross_amount - deductible` (must be > 0 when this event fires).
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
    /// Optional per-claim deductible in the **same asset units** as premium and payout.
    ///
    /// # Product rule (coverage cap interaction)
    /// The per-claim coverage cap enforced at filing is `coverage` (see `check_claim_fields`).
    /// The deductible does **not** reduce that cap: the claimant may file up to `coverage` stroops.
    /// At payout, **deductible is subtracted from the approved claim amount** (gross), so the
    /// treasury transfers `gross - deductible` when net &gt; 0; otherwise `process_claim` returns
    /// `ClaimAmountZero` on `validate::Error` (no spare `contracterror` variant on this contract).
    ///
    /// `None` or omitted semantics: treated as zero deductible at bind and payout.
    pub deductible: Option<i128>,
    /// Optional payout destination for approved claims. When unset (`None`), funds are sent to `holder`.
    ///
    /// **Phishing / social-engineering risk:** A malicious interface could trick the holder into
    /// setting a beneficiary controlled by an attacker, diverting all claim proceeds. Holders must
    /// verify the beneficiary address carefully (compare on a second channel, hardware wallet
    /// screen, or multisig quorum) before signing `initiate_policy` or `set_beneficiary`.
    pub beneficiary: Option<Address>,
    // Termination fields
    pub terminated_at_ledger: u32,
    pub termination_reason: TerminationReason,
    pub terminated_by_admin: bool,
    /// Running count of rejected claims against this policy.
    ///
    /// Incremented by `claim::on_reject` every time a claim on this policy
    /// reaches `ClaimStatus::Rejected` (whether via majority vote or deadline
    /// finalization). Never decremented; exists purely for accumulation.
    ///
    /// When `strike_count >= STRIKE_DEACTIVATION_THRESHOLD`, the policy is
    /// automatically deactivated (`is_active = false`) and the
    /// `PolicyDeactivated` event is emitted. No admin action is required.
    ///
    /// RENEWAL GATE: Any future `renew_policy` implementation MUST check
    /// `strike_count` before allowing renewal. A policy with strikes at or
    /// near the threshold should be blocked or require admin review.
    ///
    /// DATA VISIBILITY: This field is stored on-chain and permanently
    /// readable via `get_policy`. It carries only a count — no allegation
    /// narratives, no claimant-identifying data.
    pub strike_count: u32,
}

/// Return value of [`crate::policy::renew_policy`].
///
/// When the policy is already at or past `end_ledger`, the call **succeeds** with [`Lapsed`](Self::Lapsed)
/// so that [`crate::policy::PolicyExpired`] and idempotency storage are committed (a failed `Result::Err`
/// invocation would roll those writes back).
#[contracttype]
#[derive(Clone)]
pub enum RenewPolicyOutcome {
    Renewed(Policy),
    /// Ledger is at or after `end_ledger`; expiry notice recorded if due; no premium taken.
    Lapsed,
}

/// On-chain claim record.
///
/// `filed_at` is the ledger sequence at which the claim was filed.
/// `voting_deadline_ledger` is set at filing as `filed_at + voting_duration_ledgers`
/// (using the instance config **at filing time**). Votes are accepted on ledgers
/// `now <= voting_deadline_ledger` (inclusive); finalization requires `now > voting_deadline_ledger`.
#[contracttype]
#[derive(Clone)]
pub struct Claim {
    pub claim_id: u64,
    pub policy_id: u32,
    pub claimant: Address,
    pub amount: i128,
    /// Deductible copied from the policy at `file_claim` time (0 if policy had no deductible).
    pub deductible: i128,
    /// SEP-41 asset contract bound to the policy at filing time.
    pub asset: Address,
    pub details: String,
    /// Evidence attachments (URL + SHA-256 content commitment per entry).
    pub evidence: Vec<ClaimEvidenceEntry>,
    pub status: ClaimStatus,
    pub voting_deadline_ledger: u32,
    pub approve_votes: u32,
    pub reject_votes: u32,
    /// Ledger sequence at which this claim was filed (voting window anchor).
    pub filed_at: u32,
    // ── Appeal fields ────────────────────────────────────────────────────────
    /// Ledger by which `open_appeal` must be called (0 if never rejected).
    /// Set to `rejected_at + APPEAL_OPEN_WINDOW_LEDGERS` when status → Rejected.
    pub appeal_open_deadline_ledger: u32,
    /// How many appeals have been opened for this claim (cap = MAX_APPEALS_PER_CLAIM).
    pub appeals_count: u32,
    /// Voting deadline for the current appeal round (0 if no appeal open).
    pub appeal_deadline_ledger: u32,
    /// Approve votes cast in the current appeal round.
    pub appeal_approve_votes: u32,
    /// Reject votes cast in the current appeal round.
    pub appeal_reject_votes: u32,
    /// Append-only status timeline (oldest → newest). Capped at
    /// [`CLAIM_STATUS_HISTORY_MAX`]; on overflow the oldest entries are removed.
    /// May be incomplete if the cap is exceeded; `status` is authoritative.
    pub status_history: Vec<ClaimStatusHistoryEntry>,
}

/// Per-policy rolling window accumulator for **paid** claim amounts (same ledger window for all policies).
///
/// `window_start` is the first ledger of the bucket: `floor(now / window_len) * window_len`.
/// `cumulative_paid` resets when the bucket changes. Indexers can derive **remaining** as
/// `min(rolling_claim_cap - cumulative_paid, policy.coverage)` for UX (cap is global).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RollingClaimWindowState {
    pub window_start: u32,
    pub cumulative_paid: i128,
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
#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum OracleSource {
    /// Stub: no trusted source defined yet.
    Undefined,
    /// A registered oracle identified by its on-chain address.
    /// The address must have a corresponding Ed25519 public key registered via `set_oracle_pub_key`.
    Registered(Address),
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
    /// A weather-related parametric trigger (e.g., storm, flood, drought).
    WeatherEvent,
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
    pub payload: Bytes,
    /// Unix timestamp when the oracle attested this event.
    pub timestamp: u64,
    /// Ledger sequence when this trigger was recorded.
    pub trigger_ledger: u32,
    /// Replay protection nonce (must be strictly increasing per source).
    pub nonce: u64,
    /// Ed25519 signature over (policy_id || event_type || payload || timestamp || nonce).
    ///
    /// CRITICAL SECURITY NOTE:
    /// Signature verification is now implemented. The signature must be valid
    /// Ed25519 signature from the registered oracle public key for this source.
    pub signature: BytesN<64>,
}

#[cfg(not(feature = "experimental"))]
#[contracttype]
#[derive(Clone)]
pub struct OracleTrigger {
    pub policy_id: u32,
    pub event_type: TriggerEventType,
    pub source: OracleSource,
    pub payload: Bytes,
    pub timestamp: u64,
    pub trigger_ledger: u32,
    pub nonce: u64,
    pub signature: BytesN<64>,
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

#[cfg(not(feature = "experimental"))]
#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum TriggerStatus {
    Pending,
    Validated,
    Rejected,
    Executed,
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

#[cfg(not(feature = "experimental"))]
#[contracttype]
#[derive(Clone)]
pub struct ParametricClaim {
    pub claim_id: u64,
    pub trigger_id: u64,
    pub amount: i128,
    pub status: TriggerStatus,
    pub resolved_ledger: u32,
}
