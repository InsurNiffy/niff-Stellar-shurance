use soroban_sdk::{contractevent, contracttype, Address, Bytes, BytesN, Env, Map, String, Vec};

// ── Field size limits ─────────────────────────────────────────────────────────
pub const DETAILS_MAX_LEN: u32 = 256;
pub const IMAGE_URL_MAX_LEN: u32 = 128;
/// Per-URL byte limit for evidence URLs submitted with a claim.
///
/// Prevents oversized ledger entries by capping each evidence URL at 2048 bytes.
/// This is separate from [`IMAGE_URL_MAX_LEN`] which acts as a tighter bound for
/// image-specific URLs; evidence URLs may point to larger off-chain resources
/// (e.g., detailed IPFS documents) while still being bounded against abuse.
pub const MAX_EVIDENCE_URL_BYTES: u32 = 2048;
/// Default evidence attachment limit when admin config is unset.
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

/// Absolute maximum protocol fee in basis points.
pub const PROTOCOL_FEE_BPS_MAX: u32 = 1_000;

/// Solvency threshold bounds in basis points. `100_000` = 1,000%.
pub const MIN_SOLVENCY_RATIO_BPS_MIN: u32 = 0;
pub const MIN_SOLVENCY_RATIO_BPS_MAX: u32 = 100_000;

/// Hard cap on `page_size` for `get_inactive_policies`.
pub const INACTIVE_POLICIES_PAGE_SIZE_MAX: u32 = 20;

// ── Enums ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum PolicyType {
    Auto,
    Health,
    Property,
}

/// Per-policy-type admin configuration stored in the registry.
///
/// `payout_asset_override`: when `Some(asset)`, approved claims for this policy type
/// are paid out in `asset` instead of the policy's premium asset. The override asset
/// must be allowlisted at the time it is configured (validated in the admin setter).
///
/// When `None`, payout falls back to the policy's bound premium asset (existing behaviour).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolicyTypeConfig {
    /// Optional SEP-41 asset contract to use for claim payouts.
    /// Must be allowlisted when set. `None` = use premium asset (default).
    pub payout_asset_override: Option<Address>,
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
///   Approved    → PayoutTimeout (keeper calls `process_payout_timeout` after `payout_deadline_ledger`)
///
/// Appeal-flow transitions (requires Rejected status + open appeal window):
///   Rejected    → UnderAppeal   (claimant calls open_appeal within window)
///   UnderAppeal → AppealApproved (majority approve appeal vote or deadline)
///   UnderAppeal → AppealRejected (majority reject appeal vote or deadline)
///   AppealApproved → Paid       (admin calls process_claim — same as Approved)
///
/// Terminal states (no further transitions): Paid, Rejected (after appeal window
/// closes), AppealApproved (→ Paid only), AppealRejected, Withdrawn.
///
/// # Forward compatibility
///
/// Discriminant values are explicit and **stable**. The XDR encoding of a
/// `ClaimStatus` value depends on its discriminant position; if variants were
/// added or removed without explicit values the encoding of existing persisted
/// data would shift, corrupting all stored claims.
///
/// Rules for adding new variants:
/// 1. Always append at the **end** of this enum — never insert in the middle.
/// 2. Assign the next sequential explicit discriminant (current max = 11).
/// 3. Update `is_terminal()` if the new variant is terminal.
/// 4. Add a decode test in the indexer (`events.schema.ts` / `events.test.ts`).
/// 5. Do **not** renumber existing variants for any reason.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ClaimStatus {
    Processing = 0,
    Pending = 1,
    Approved = 2,
    PayoutTimeout = 3,
    Paid = 4,
    Rejected = 5,
    /// Claimant has opened an appeal; fresh vote round in progress.
    UnderAppeal = 6,
    /// Appeal vote resolved in claimant's favour; awaits admin payout.
    AppealApproved = 7,
    /// Appeal vote rejected; claim is permanently closed.
    AppealRejected = 8,
    /// Claimant withdrew before voting began; record kept for audit; no payout.
    Withdrawn = 9,
    /// Admin disputed the claim after approval; payout is frozen pending review.
    Disputed = 10,
    /// RESERVED — superseded by `UnderAppeal`. Never constructed. Kept, not removed.
    ///
    /// # Decision (recorded)
    ///
    /// The appeal flow was implemented using **`UnderAppeal` (discriminant 6)**,
    /// not this variant. `Appealed` predates that implementation: it was reserved
    /// while the appeal design was still open, and by the time `open_appeal` /
    /// `vote_on_appeal` / `finalize_appeal` shipped, `UnderAppeal` had already been
    /// picked as the live in-flight status. Removing `Appealed` now would be a
    /// breaking ABI change (discriminants are positional in XDR — see the
    /// forward-compatibility note above), for a variant that costs nothing to
    /// leave in place. Decision: **keep it reserved, do not remove it, do not
    /// repurpose it.** Do not construct it in any entrypoint; use `UnderAppeal`
    /// for "appeal in progress" everywhere.
    ///
    /// This variant is declared only to **reserve the discriminant** in the
    /// on-chain ABI so a future variant can't accidentally collide with it.
    /// Default builds compile without ever constructing this variant — it exists
    /// in the type system but is unreachable through any live code path.
    ///
    /// # Relationship to `UnderAppeal`
    ///
    /// Read `Appealed` in this file as historical/reserved and `UnderAppeal` as
    /// canonical. The real appeal lifecycle is:
    ///
    /// ```text
    /// Rejected     → UnderAppeal      (claimant calls open_appeal within APPEAL_OPEN_WINDOW_LEDGERS)
    ///                                  appeal vote runs for APPEAL_VOTE_WINDOW_LEDGERS
    /// UnderAppeal  → AppealApproved   (majority approve or deadline plurality)
    /// UnderAppeal  → AppealRejected   (majority reject or deadline plurality)
    /// ```
    ///
    /// `is_terminal()` returns `false` for `UnderAppeal` (not for `Appealed`,
    /// which is never reached) so voting/finalization guards correctly reject
    /// further transitions until the appeal round resolves.
    Appealed = 11,
}

impl ClaimStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            ClaimStatus::Approved
                | ClaimStatus::PayoutTimeout
                | ClaimStatus::Paid
                | ClaimStatus::Rejected
                | ClaimStatus::AppealApproved
                | ClaimStatus::AppealRejected
                | ClaimStatus::Withdrawn
                | ClaimStatus::Disputed // NOTE: ClaimStatus::Appealed is intentionally absent — an appeal
                                        // in progress is NOT terminal.  Adding it here would allow
                                        // process_claim / finalize_claim to close an appealed claim without
                                        // resolving the appeal round, which would be incorrect.
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

/// Active vote delegation binding for a holder.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoteDelegation {
    pub delegate: Address,
    pub expiry_ledger: u32,
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

/// Reason for pausing the protocol.
///
/// Stored alongside the pause state so incident responders can understand
/// the halt from on-chain data alone without relying on off-chain communication.
///
/// # Variants
/// - `SecurityIncident`: Active exploit or vulnerability being mitigated.
/// - `UpgradePending`: Planned upgrade requiring a maintenance window.
/// - `SolvencyRisk`: Treasury or reserve concerns requiring investigation.
/// - `Regulatory`: Regulatory directive or compliance hold.
///
/// # TTL constants rationale
/// Pause state is stored in instance storage (always live while the contract
/// is deployed). No separate TTL management is needed for pause state itself.
///
/// # Unpause behaviour
/// When `unpause` is called, the stored `PauseReason` is cleared (set to `None`).
/// Callers can verify the reason is cleared via `get_pause_reason()`.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum PauseReason {
    SecurityIncident,
    UpgradePending,
    SolvencyRisk,
    Regulatory,
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

/// Maximum claim IDs in a single `get_claims_batch` call.
///
/// This intentionally matches [`PAGE_SIZE_MAX`] so dashboard simulations can
/// bulk-load claims without unbounded metered storage reads.
pub const CLAIM_BATCH_GET_MAX: u32 = PAGE_SIZE_MAX;

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
    /// Off-chain URI to the policy governing document. Must be non-empty.
    pub metadata_uri: String,
    /// Optional region code validated against the admin-managed region registry.
    pub region_code: Option<String>,
    /// SHA-256 hash of the insurance terms document in effect at bind time.
    /// Must be non-zero (all-zero digest is rejected as uninitialized).
    pub terms_hash: BytesN<32>,
}

impl InitiatePolicyOptions {
    pub fn test_defaults(env: &Env) -> Self {
        let mut hash_bytes = [0u8; 32];
        hash_bytes[0] = 1; // non-zero sentinel for tests
        Self {
            beneficiary: None,
            deductible: None,
            expected_nonce: None,
            metadata_uri: String::from_str(env, "ipfs://test-policy"),
            region_code: None,
            terms_hash: BytesN::from_array(env, &hash_bytes),
        }
    }
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

// ── Event subscription filter system ─────────────────────────────────────────

/// Maximum active subscriptions per address.
pub const MAX_SUBSCRIPTIONS_PER_ADDRESS: u32 = 10;

/// Event type filter for subscriptions.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum EventType {
    PolicyInitiated,
    ClaimFiled,
    ClaimFinalized,
    ClaimPaid,
    VoteCast,
}

/// An on-chain subscription filter for off-chain indexers.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Subscription {
    pub id: u64,
    pub owner: Address,
    /// Event types this subscription matches.
    pub event_types: Vec<EventType>,
    /// Pet/policy IDs this subscription matches (empty = all).
    pub pet_ids: Vec<u64>,
    /// Ledger at which this subscription expires.
    pub expires_at: u32,
}

// ── Vet specialization ────────────────────────────────────────────────────────

/// Vet medical specializations. Certain record types require a matching specialization.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Specialization {
    GeneralPractice,
    Surgery,
    Dermatology,
    Oncology,
    Dentistry,
}

/// Medical record types that may require a specific vet specialization.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum MedicalRecordType {
    GeneralConsult,
    SurgeryNotes,
    DermatologyReport,
    OncologyReport,
    DentalProcedure,
}

impl MedicalRecordType {
    /// Returns the required specialization for this record type, if any.
    pub fn required_specialization(&self) -> Option<Specialization> {
        match self {
            MedicalRecordType::GeneralConsult => None,
            MedicalRecordType::SurgeryNotes => Some(Specialization::Surgery),
            MedicalRecordType::DermatologyReport => Some(Specialization::Dermatology),
            MedicalRecordType::OncologyReport => Some(Specialization::Oncology),
            MedicalRecordType::DentalProcedure => Some(Specialization::Dentistry),
        }
    }
}

// ── Region registry ───────────────────────────────────────────────────────────

/// Configuration for a region code in the admin-managed registry.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegionConfig {
    /// Optional parent region code (empty string = no parent).
    pub parent: String,
    /// Risk multiplier in basis points (10_000 = 1×). Applied on top of the tier multiplier.
    pub risk_multiplier: i128,
    /// Whether this region accepts new policies.
    pub active: bool,
}

/// Identifies a single row in the multiplier table for granular admin updates.
///
/// # Key format
/// - `Region(tier)` — one of `RegionTier::{Low, Medium, High}`
/// - `Age(band)` — one of `AgeBand::{Young, Adult, Senior}`
/// - `Coverage(tier)` — one of `CoverageTier::{Basic, Standard, Premium}`
/// - `SafetyDiscount` — the flat discount applied when `safety_score > 0`
///
/// # Valid value ranges
/// - `Region`, `Age`, `Coverage` entries: `MIN_MULTIPLIER..=MAX_MULTIPLIER` (5_000–20_000, scale 10_000 = 1×)
/// - `SafetyDiscount`: `0..=MAX_SAFETY_DISCOUNT` (0–5_000)
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MultiplierKey {
    Region(RegionTier),
    Age(AgeBand),
    Coverage(CoverageTier),
    SafetyDiscount,
}

#[contractevent(topics = ["niffyinsure", "premium_table_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PremiumTableUpdated {
    pub version: u32,
}

/// Emitted by `admin_set_premium_multiplier` for each granular update.
/// topics: ("niffyinsure", "premium_multiplier_updated")
#[contractevent(topics = ["niffyinsure", "premium_multiplier_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PremiumMultiplierUpdated {
    pub key: MultiplierKey,
    pub old_value: i128,
    pub new_value: i128,
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
    /// Off-chain URI to the policy governing document.
    /// Must be non-empty at policy creation. Admin can update via `update_policy_metadata_uri`.
    pub metadata_uri: String,
    /// SHA-256 hash of the insurance terms document in effect at bind time.
    ///
    /// Commits the policy to an exact version of the coverage conditions and exclusions.
    /// Stored at `initiate_policy` time and immutable thereafter — no entrypoint modifies it.
    /// Must be non-zero (all-zero hash is rejected as an uninitialized value sentinel).
    ///
    /// Off-chain verification: download the terms document at `metadata_uri` and compare its
    /// SHA-256 digest against this field to confirm the on-chain commitment matches.
    pub terms_hash: BytesN<32>,
    /// Decimal precision of the bound asset, queried from the token contract at bind time.
    /// Stored so payout math can be decimal-aware without a cross-contract call at payout.
    /// 0 = unknown / not queried (legacy policies).
    pub token_decimals: u32,
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
    /// Ledger by which an approved payout must be executed or the claim auto-times out.
    pub payout_deadline_ledger: u32,
    pub approve_votes: u32,
    pub reject_votes: u32,
    /// Ledger sequence at which this claim was filed (voting window anchor).
    pub filed_at: u32,
    /// Number of eligible voters in the snapshot taken at filing time.
    /// Used for quorum calculation so the result is stable even if the
    /// snapshot TTL expires before finalization.
    pub eligible_voter_count: u32,
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
    /// Ledger by which admin must dispute the claim (set after finalization).
    /// After this ledger passes, payout executes automatically for approved claims.
    /// Set to 0 if no dispute window is active.
    pub dispute_deadline_ledger: u32,
    /// Running total of tokens disbursed so far (in stroops).
    /// When `paid_amount >= amount - deductible`, the claim transitions to `Paid`.
    pub paid_amount: i128,
    /// Number of installment disbursements made against this claim.
    pub installment_count: u32,
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

/// Human-readable identity information returned by `get_contract_metadata`.
///
/// All fields are compile-time constants; no storage reads occur on the call path.
/// Safe to call via simulation without authentication.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractMetadata {
    pub name: String,
    pub version: String,
    /// Short hint identifying the target Stellar network (non-binding, for tooling convenience).
    pub network_passphrase_hint: String,
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
// Implementation complete

// ── Issue #587: Asset-specific claim amount bounds ────────────────────────────

/// Per-asset minimum and maximum claim amount configuration.
/// Prevents dust claims (below min) and over-coverage claims (above max).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllowedAssetConfig {
    /// Minimum claim amount in asset units. Claims below this revert.
    pub min_claim_amount: i128,
    /// Maximum claim amount in asset units. Claims above this revert.
    pub max_claim_amount: i128,
}

// ── Issue #585: Admin role delegation ────────────────────────────────────────

/// Permission flags for a delegated operator.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DelegationPermissions {
    /// Operator may call set_claim_fraud_score.
    pub can_set_fraud_score: bool,
    /// Operator may call set_allowed_asset_config.
    pub can_set_asset_config: bool,
    /// Operator may call set_reinsurance_contract.
    pub can_set_reinsurance: bool,
}

/// On-chain delegation record stored per operator address.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DelegationRecord {
    /// The admin who granted this delegation.
    pub grantor: Address,
    /// Ledger sequence after which this delegation is no longer valid.
    pub expiry_ledger: u32,
    /// Permissions granted to the operator.
    pub permissions: DelegationPermissions,
}

/// Discrete permission scope exposed by `list_active_delegated_scopes` (Issue #1149).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DelegatedScopeKind {
    SetFraudScore,
    SetAssetConfig,
    SetReinsurance,
}

/// One active delegated scope for an operator address.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActiveDelegatedScope {
    pub scope: DelegatedScopeKind,
    pub grantor: Address,
    pub expiry_ledger: u32,
}

// ── Issue #581: Reinsurance pool events ──────────────────────────────────────

/// Emitted when reinsurance funds are drawn to cover a claim shortfall.
#[contractevent(topics = ["niffyinsure", "reinsurance_drawdown"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReinsuranceDrawdown {
    #[topic]
    pub claim_id: u64,
    /// Amount paid from the primary treasury.
    pub primary_amount: i128,
    /// Amount drawn from the reinsurance pool.
    pub reinsurance_amount: i128,
    /// Reinsurance contract address used.
    pub reinsurance_contract: Address,
}
