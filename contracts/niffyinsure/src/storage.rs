use soroban_sdk::{contracttype, Address, Env, Map, String, Vec};

use crate::ledger;
use crate::types::{
    Claim, MultiplierTable, Policy, RollingClaimWindowState, VoteDelegation, VoteOption,
};

// ── TTL constants ─────────────────────────────────────────────────────────────
///
/// # TTL Management Strategy
///
/// Soroban persistent storage entries expire when their TTL reaches zero.
/// This contract uses a systematic approach to prevent data loss:
///
/// ## Constants and Their Relationships
///
/// - `PERSISTENT_TTL_THRESHOLD` (100,000 ledgers ~ 5.8 days): When remaining TTL
///   falls below this threshold, `extend_ttl` operations will extend the entry.
///
/// - `PERSISTENT_TTL_EXTEND_TO` (6,000,000 ledgers ~ 1 year): Target TTL after
///   extension. Provides ~12x buffer over maximum policy duration (518,400 ledgers ~ 30 days).
///
/// - `DEFAULT_TTL_ALERT_THRESHOLD` (600,000 ledgers ~ 1 month): Default alert
///   threshold for TTL expiry notifications (10% of PERSISTENT_TTL_EXTEND_TO).
///
/// ## Policy Duration Relationship
///
/// - Maximum policy duration: 518,400 ledgers (~30 days)
/// - TTL extension target: 6,000,000 ledgers (~1 year)
/// - Safety factor: ~11.6x policy duration
///
/// This ensures policies can complete multiple renewal cycles without TTL expiry,
/// even with administrative delays or keeper maintenance windows.
///
/// ## Claim Voting TTL
///
/// Claim voter snapshots use separate constants aligned with voting windows:
/// - `CLAIM_VOTER_SNAPSHOT_TTL_THRESHOLD`: MAX_VOTING_DURATION_LEDGERS + 1 week
/// - `CLAIM_VOTER_SNAPSHOT_EXTEND_TO`: MAX_VOTING_DURATION_LEDGERS + 3 weeks
///
/// Minimum TTL threshold before we extend (in ledgers).
pub const PERSISTENT_TTL_THRESHOLD: u32 = 100_000;
/// Target TTL after extension (in ledgers, ~1 year).
pub const PERSISTENT_TTL_EXTEND_TO: u32 = 6_000_000;

// ── Claim voter snapshot TTL (persistent `ClaimVoters`) ───────────────────────
//
// Soroban persistent entries have a ledger TTL; when they expire the key is
// removed. These values are sized from [`ledger::MAX_VOTING_DURATION_LEDGERS`]
// so snapshots stay live through the longest allowed vote plus keeper margin.
// See Stellar docs on state archival and TTL:
// <https://developers.stellar.org/docs/learn/smart-contract-internals/state-archival>
//
/// When remaining TTL for a `ClaimVoters` entry is below this (in ledgers),
/// `extend_ttl` may extend it toward [`CLAIM_VOTER_SNAPSHOT_EXTEND_TO`].
pub const CLAIM_VOTER_SNAPSHOT_TTL_THRESHOLD: u32 =
    ledger::MAX_VOTING_DURATION_LEDGERS + ledger::LEDGERS_PER_WEEK;

/// Minimum target remaining TTL (ledgers from current sequence) after extension
/// for `ClaimVoters` keys (max voting window + ~3 weeks for permissionless refresh cadence).
pub const CLAIM_VOTER_SNAPSHOT_EXTEND_TO: u32 =
    ledger::MAX_VOTING_DURATION_LEDGERS + 3 * ledger::LEDGERS_PER_WEEK;

// ── DataKey ───────────────────────────────────────────────────────────────────

/// Exhaustive enumeration of every storage key used by the contract.
#[contracttype]
pub enum DataKey {
    // ── Instance tier ────────────────────────────────────────────────────
    Admin,
    PendingAdmin,
    /// Expiry ledger for pending admin proposal (time lock).
    PendingAdminExpiry,
    Token,
    /// Address where collected premiums are sent.
    Treasury,
    /// Basis-point protocol fee deducted from each premium payment.
    ProtocolFeeBps,
    /// Address receiving the protocol fee portion of premiums.
    FeeRecipient,
    /// Minimum treasury solvency ratio required before binding new policies.
    MinSolvencyRatioBps,
    PremiumTable,
    CalcAddress,
    /// Boolean allowlist flag per asset contract address.
    AllowedAsset(Address),
    Voters,
    ClaimCounter,
    Paused,
    /// Active pause reason when the contract is paused.
    PauseReason,
    /// New: pending high-risk admin action
    PendingAdminAction,
    /// Optional per-transaction cap for emergency sweep operations (i128).
    SweepCap,
    /// Minimum ledgers that must elapse between sweep proposal and execution (notice period).
    /// 0 = disabled. Default: 0 (off). Recommended mainnet value: ~2880 (~4 hours @ 5s/ledger).
    SweepNoticePeriodLedgers,
    /// Configurable ledger window for pending admin actions (default: 100 ledgers ~30min).
    AdminActionWindowLedgers,
    ActivePolicyCount(Address),
    /// Max total **paid** claim amount per policy per rolling ledger window (gross `claim.amount`).
    RollingClaimCap,
    /// Ledger length of each rolling window (bucket alignment uses current ledger sequence).
    RollingClaimWindowLedgers,
    /// Admin-configurable max evidence entries per claim (u32).
    /// Falls back to [`IMAGE_URLS_MAX`] when unset.
    MaxEvidenceCount,
    /// Admin-configurable minimum evidence entries required per claim (u32).
    /// Falls back to 0 when unset (no minimum enforced).
    MinEvidenceCount,
    /// Maximum vote weight any single voter can contribute when governance token is enabled.
    /// Falls back to `i128::MAX` (uncapped) when unset.
    MaxWeightCap,
    /// Per-policy last resolved claim ledger for cooldown enforcement.
    LastClaimResolvedLedger(Address, u32),
    /// Admin-configurable cooldown window in ledgers between claim resolutions per policy.
    /// Falls back to 0 (no cooldown) when unset.
    CooldownLedgers,
    /// Last `end_ledger` for which a PolicyExpired event was emitted for this policy term.
    PolicyExpiredEventEndLedger(Address, u32),
    /// Allowlisted IPFS gateway URL prefixes for evidence validation.
    GatewayAllowlist,
    // ── Reserved: future governance token (`governance_token` module) ────────
    /// Runtime toggle: only meaningful when crate is built with `governance-token`.
    /// Unset or `false` in MVP; no token logic runs unless feature + flag align.
    GovernanceTokenRuntimeEnabled,
    /// Future token contract address (stub storage only; no transfers in this crate yet).
    GovernanceTokenAddress,
    /// Future schema / migration version for governance-token config.
    GovernanceTokenConfigVersion,
    /// Monotonic governance proposal id counter.
    ProposalCounter,
    /// Governance proposal record keyed by proposal id.
    Proposal(u64),
    /// (proposal_id, voter) -> vote weight recorded for governance proposals.
    ProposalVote(u64, Address),
    // ── Persistent tier ──────────────────────────────────────────────────
    Policy(Address, u32),
    PolicyCounter(Address),
    Claim(u64),
    /// Temp key for open claim check (policy_holder, policy_id) -> bool
    OpenClaim(Address, u32),
    /// (claim_id, voter_address) -> VoteOption; immutable after first write
    Vote(u64, Address),
    /// Delegator -> active vote delegation binding.
    VoteDelegations,
    /// Snapshot of eligible voters captured at claim-filing time.
    ClaimVoters(u64),
    /// Last ledger at which `holder` filed a claim (rate-limit anchor).
    LastClaimLedger(Address),
    /// (claim_id, voter_address) -> VoteOption for appeal round; immutable after first write.
    AppealVote(u64, Address),
    /// Configurable voting window in ledgers (set by admin via set_voting_duration_ledgers).
    VoteDurLedgers,
    /// Participation quorum in basis points (1–10_000). New claims snapshot this at filing.
    QuorumBps,
    /// Configurable grace period in ledgers after nominal expiry for late renewals.
    GracePeriodLedgers,
    /// Per-claim snapshot of `QuorumBps` at `file_claim` time (immutable for that claim).
    ClaimQuorumBps(u64),
    /// Value of `LastClaimLedger(claimant)` **before** this claim's filing updated it.
    /// Removed when the claim leaves `Processing` without withdraw, or consumed by `withdraw_claim`.
    ClaimRateLimitPrev(u64),
    /// Per-holder replay-protection nonce. Incremented on each successful mutating call
    /// when the caller supplies `expected_nonce`. Supplementary to Stellar sequence numbers.
    HolderNonce(Address),
    /// Configurable threshold for TTL expiry alerts (instance storage).
    TtlAlertThreshold,
    // ── Oracle / parametric trigger (experimental) ────────────────────────
    /// Monotonically increasing trigger ID counter.
    TriggerCounter,
    /// Full trigger record keyed by trigger_id.
    OracleTrigger(u64),
    /// Current status of a trigger.
    TriggerStatus(u64),
    /// Whether oracle triggers are globally enabled (admin toggle).
    OracleEnabled,
    /// Registered Ed25519 public key (32 bytes) for an oracle source address.
    OraclePubKey(Address),
    /// Last accepted nonce per oracle source address (replay protection).
    OracleNonce(Address),
    /// Required quorum count for a given oracle source (0 = single-sig).
    OracleQuorum(Address),
    // ── Rolling claim cap (persistent) ───────────────────────────────────────
    /// Per-policy rolling window accumulator: (holder, policy_id) → RollingClaimWindowState.
    RollingClaimState(Address, u32),
    // ── Commit-reveal voting ──────────────────────────────────────────────────
    /// Commit and reveal phase ledger boundaries for a claim.
    CommitRevealPhases(u64),
    /// Voter's 32-byte commitment hash: SHA-256(vote_byte || salt).
    VoteCommitment(u64, Address),
    // ── Policy type registry ──────────────────────────────────────────────────
    /// Admin-managed per-policy-type configuration (payout override, active flag).
    PolicyTypeConfig(crate::types::PolicyType),
    /// Whether a policy type is registered and active in the registry.
    PolicyTypeActive(crate::types::PolicyType),
    /// Whether the policy type registry is enabled (set on first registration).
    PolicyTypeRegistryEnabled,
    // ── Per-asset premium table ───────────────────────────────────────────────
    /// Asset-specific multiplier table (falls back to global default when absent).
    AssetPremiumTable(Address),
    // ── KYC whitelist (Issue #2) ──────────────────────────────────────────────
    /// Whether the KYC whitelist is currently enforced for initiate_policy calls.
    WhitelistEnabled,
    /// Per-address whitelist entry for KYC compliance gating.
    Whitelisted(Address),
    /// Optional flat fee (stroops) charged to the claimant at file_claim.
    /// 0 = disabled. Transferred directly to the treasury before claim creation.
    ClaimFilingFee,
    // ── Appeal mechanism (Issue #1) ───────────────────────────────────────────
    /// Voter snapshot for an appeal round (separate from the base-claim snapshot).
    AppealVoters(u64),
    /// Per-claim quorum bps snapshot frozen at appeal-open time (immutable for that round).
    AppealClaimQuorumBps(u64),
    // ── Issue #583: Claim fraud score ─────────────────────────────────────────
    ClaimFraudScore(u64),
    FraudScoreThreshold,
    ElevatedQuorumBps,
    // ── Issue #587: Asset-specific claim amount bounds ───────────────────────
    AllowedAssetConfig(Address),
    // ── Issue #585: Admin role delegation ────────────────────────────────────
    Delegation(Address),
    /// Ordered index of operators that currently have a stored delegation record.
    DelegationOperatorIndex,
    // ── Issue #581: Reinsurance pool ─────────────────────────────────────────
    ReinsuranceContract,
    // ── Treasury depositor allowlist ─────────────────────────────────────────
    AuthorizedDepositor(Address),
    // ── Contract payout recipient allowlist ──────────────────────────────────
    AllowedPayoutRecipient(Address),
    // ── Region registry ──────────────────────────────────────────────────────
    RegionRegistry,
    // ── Treatment tracking ───────────────────────────────────────────────────
    TreatmentCount(u64),
    // ── Vet specialization registry ──────────────────────────────────────────
    VetSpecializations(Address),
    // ── Event subscription filter system ───────────────────────────────────────
    SubscriptionCounter,
    Subscription(u64),
    OwnerSubscriptionIds(Address),
    // ── Governance cooldown (Issue #844) ──────────────────────────────────────
    GovernanceCooldownLedgers,
    LastParamChangeLedger,
    // ── Treasury withdrawal limit (Issue #845) ────────────────────────────────
    MaxSweepPerLedger,
    LastSweepLedger,
    CumulativeSweptThisLedger,
    // ── Ledger close time estimate (Issue #842) ───────────────────────────────
    /// Admin-configurable seconds-per-ledger estimate for UI deadline display.
    /// Falls back to [`crate::ledger::SECS_PER_LEDGER`] (5) when unset.
    SecsPerLedgerEstimate,
    // ── Admin role separation (Issue #1161) ───────────────────────────────────
    /// Address authorized to call pause/unpause. Falls back to Admin when unset.
    PauseAdmin,
    /// Address authorized to call treasury operations (drain, sweep, rotation). Falls back to Admin.
    TreasuryAdmin,
    /// Address authorized to call governance parameter changes. Falls back to Admin.
    ParamAdmin,
    // ── Issue #787: Coverage amount floor ────────────────────────────────────
    MinCoverageAmount,
    // ── Issue #783: Voter count hard cap ─────────────────────────────────────
    MaxVotersPerClaim,
    // ── Issue #782: Token decimal normalization ───────────────────────────────
    /// Stored decimals for an allowlisted asset (queried at bind time).
    AssetDecimals(Address),
}

pub fn has_open_claim(env: &Env, holder: &Address, policy_id: u32) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::OpenClaim(holder.clone(), policy_id))
        .unwrap_or(false)
}

pub fn set_open_claim(env: &Env, holder: &Address, policy_id: u32, open: bool) {
    env.storage()
        .instance()
        .set(&DataKey::OpenClaim(holder.clone(), policy_id), &open);
}

/// Extend instance storage TTL so admin/token/counters are never evicted.
/// Call at the start of every mutating entrypoint.
pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

// ── Admin ─────────────────────────────────────────────────────────────────────

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("contract not initialised: admin missing")
}

pub fn set_pending_admin(env: &Env, pending: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::PendingAdmin, pending);
}

pub fn get_pending_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::PendingAdmin)
}

pub fn set_pending_admin_expiry(env: &Env, expiry_ledger: u32) {
    env.storage()
        .instance()
        .set(&DataKey::PendingAdminExpiry, &expiry_ledger);
}

pub fn get_pending_admin_expiry(env: &Env) -> Option<u32> {
    env.storage().instance().get(&DataKey::PendingAdminExpiry)
}

pub fn clear_pending_admin(env: &Env) {
    env.storage().instance().remove(&DataKey::PendingAdmin);
    env.storage()
        .instance()
        .remove(&DataKey::PendingAdminExpiry);
}

// ── New: Pending Admin Action ─────────────────────────────────────────────────

pub fn has_pending_admin_action(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::PendingAdminAction)
}

pub fn set_pending_admin_action(env: &Env, pending: &crate::admin::PendingAdminAction) {
    env.storage()
        .instance()
        .set(&DataKey::PendingAdminAction, pending);
    env.storage()
        .instance()
        .extend_ttl(PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

pub fn get_pending_admin_action(env: &Env) -> Option<crate::admin::PendingAdminAction> {
    env.storage().instance().get(&DataKey::PendingAdminAction)
}

pub fn clear_pending_admin_action(env: &Env) {
    env.storage()
        .instance()
        .remove(&DataKey::PendingAdminAction);
}

/// Check expiry and auto-clear/emit if expired.
/// Returns Some(pending) if valid, None if expired (caller should panic).
pub fn check_and_clear_expired_admin_action(env: &Env) -> Option<crate::admin::PendingAdminAction> {
    let pending_opt = get_pending_admin_action(env);
    if let Some(pending) = pending_opt {
        let now = env.ledger().sequence();
        if now > pending.expiry_ledger {
            clear_pending_admin_action(env);
            crate::admin::AdminActionExpired {
                proposer: pending.proposer.clone(),
                action_id: now.saturating_sub(get_admin_action_window_ledgers(env)),
                expiry_ledger: pending.expiry_ledger,
                action: pending.action.clone(),
            }
            .publish(env);
            None
        } else {
            Some(pending)
        }
    } else {
        None
    }
}

pub fn get_admin_action_window_ledgers(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::AdminActionWindowLedgers)
        .unwrap_or(100u32) // Default ~30min @ 5s/ledger
}

// ── Token (default asset) ─────────────────────────────────────────────────────

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn get_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .expect("contract not initialised: token missing")
}

// ── Treasury ──────────────────────────────────────────────────────────────────

pub fn set_treasury(env: &Env, treasury: &Address) {
    env.storage().instance().set(&DataKey::Treasury, treasury);
}

pub fn get_treasury(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Treasury)
        .unwrap_or_else(|| env.current_contract_address())
}

// ── Protocol fee config (instance) ───────────────────────────────────────────

pub fn set_protocol_fee_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&DataKey::ProtocolFeeBps, &bps);
}

pub fn get_protocol_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::ProtocolFeeBps)
        .unwrap_or(0)
}

pub fn set_fee_recipient(env: &Env, recipient: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::FeeRecipient, recipient);
}

pub fn get_fee_recipient(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::FeeRecipient)
        .unwrap_or_else(|| env.current_contract_address())
}

// ── Solvency config (instance) ───────────────────────────────────────────────

pub fn set_min_solvency_ratio_bps(env: &Env, bps: u32) {
    env.storage()
        .instance()
        .set(&DataKey::MinSolvencyRatioBps, &bps);
}

pub fn get_min_solvency_ratio_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::MinSolvencyRatioBps)
        .unwrap_or(0)
}

pub fn outstanding_approved_claim_obligations(env: &Env, asset: &Address) -> i128 {
    let claim_counter = get_claim_counter(env);
    let mut total: i128 = 0;

    for claim_id in 1..=claim_counter {
        if let Some(claim) = get_claim(env, claim_id) {
            if claim.status == crate::types::ClaimStatus::Approved && claim.asset == *asset {
                let net = claim.amount.saturating_sub(claim.deductible);
                if net > 0 {
                    total = total.saturating_add(net);
                }
            }
        }
    }

    total
}

// ── Governance: claim voting duration (instance) ─────────────────────────────

pub fn set_voting_duration_ledgers(env: &Env, ledgers: u32) {
    env.storage()
        .instance()
        .set(&DataKey::VoteDurLedgers, &ledgers);
}

/// Configured duration added at each `file_claim` to compute `voting_deadline_ledger`.
/// Defaults to [`ledger::VOTE_WINDOW_LEDGERS`] when unset (pre-migration deployments).
pub fn get_voting_duration_ledgers(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::VoteDurLedgers)
        .unwrap_or(ledger::VOTE_WINDOW_LEDGERS)
}

// ── Claim voting quorum (instance + per-claim snapshot) ───────────────────────

pub fn set_quorum_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&DataKey::QuorumBps, &bps);
}

/// Current instance quorum (basis points). Defaults to [`crate::types::DEFAULT_QUORUM_BPS`].
pub fn get_quorum_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::QuorumBps)
        .unwrap_or(crate::types::DEFAULT_QUORUM_BPS)
}

pub fn set_claim_quorum_bps(env: &Env, claim_id: u64, bps: u32) {
    let key = DataKey::ClaimQuorumBps(claim_id);
    env.storage().persistent().set(&key, &bps);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

/// Quorum basis points frozen for this claim at filing. Missing key ⇒ legacy claim:
/// use [`crate::types::DEFAULT_QUORUM_BPS`] so admin quorum changes never retroactively
/// alter `Processing` claims that predate per-claim snapshots.
pub fn get_claim_quorum_bps(env: &Env, claim_id: u64) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::ClaimQuorumBps(claim_id))
        .unwrap_or(crate::types::DEFAULT_QUORUM_BPS)
}

// ── Grace period (instance) ───────────────────────────────────────────────────

pub fn set_grace_period_ledgers(env: &Env, ledgers: u32) {
    env.storage()
        .instance()
        .set(&DataKey::GracePeriodLedgers, &ledgers);
}

/// Grace period added after nominal expiry for late renewals.
/// Defaults to [`ledger::DEFAULT_GRACE_PERIOD_LEDGERS`] when unset.
pub fn get_grace_period_ledgers(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::GracePeriodLedgers)
        .unwrap_or(ledger::DEFAULT_GRACE_PERIOD_LEDGERS)
}

// ── External calculator address ───────────────────────────────────────────────

pub fn set_calc_address(env: &Env, addr: &Address) {
    env.storage().instance().set(&DataKey::CalcAddress, addr);
}

pub fn get_calc_address(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::CalcAddress)
}

// ── Premium table ─────────────────────────────────────────────────────────────

pub fn set_multiplier_table(env: &Env, table: &MultiplierTable) {
    env.storage().instance().set(&DataKey::PremiumTable, table);
}

pub fn get_multiplier_table(env: &Env) -> MultiplierTable {
    env.storage()
        .instance()
        .get(&DataKey::PremiumTable)
        .expect("premium table not initialised")
}

// ── Asset allowlist ───────────────────────────────────────────────────────────

pub fn set_allowed_asset(env: &Env, asset: &Address, allowed: bool) {
    env.storage()
        .instance()
        .set(&DataKey::AllowedAsset(asset.clone()), &allowed);
}

pub fn is_allowed_asset(env: &Env, asset: &Address) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::AllowedAsset(asset.clone()))
        .unwrap_or(false)
}

// ═════════════════════════════════════════════════════════════════════════════
// PAUSE SYSTEM
//
// Granular pause flags for operational flexibility:
//   - bind_paused: blocks new policy initiation/renewal
//   - claims_paused: blocks filing claims and voting
//
// Read-only methods continue to work for transparency.
// Admin-triggered payouts (process_claim) continue during pause to avoid trapping funds.
// ═════════════════════════════════════════════════════════════════════════════

/// Pause flags: separate controls for binding new policies vs filing claims.
/// Both false by default (unpaused state).
#[contracttype]
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct PauseFlags {
    pub bind_paused: bool,
    pub claims_paused: bool,
}

/// Central assertion: panics if ANY pause flag is set.
/// Use for entrypoints that should be blocked by any pause.
pub fn assert_not_paused(env: &Env) {
    if is_paused(env) {
        panic!("protocol paused for maintenance");
    }
}

/// Assertion for policy binding operations (initiate/renew policy).
/// Only blocks if bind_paused is true.
pub fn assert_bind_not_paused(env: &Env) {
    let flags = get_pause_flags(env);
    if flags.bind_paused {
        panic!("protocol paused for maintenance: policy binding disabled");
    }
}

/// Assertion for claim operations (file claim, vote, finalize).
/// Only blocks if claims_paused is true.
pub fn assert_claims_not_paused(env: &Env) {
    let flags = get_pause_flags(env);
    if flags.claims_paused {
        panic!("protocol paused for maintenance: claims disabled");
    }
}

/// Get current pause state (legacy compatibility - returns true if ANY flag is set).
pub fn is_paused(env: &Env) -> bool {
    let flags = get_pause_flags(env);
    flags.bind_paused || flags.claims_paused
}

/// Get detailed pause flags.
pub fn get_pause_flags(env: &Env) -> PauseFlags {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or_default()
}

/// Set full pause state (legacy compatibility - sets both flags).
pub fn set_paused(env: &Env, paused: bool) {
    let flags = PauseFlags {
        bind_paused: paused,
        claims_paused: paused,
    };
    env.storage().instance().set(&DataKey::Paused, &flags);
}

/// Set granular pause flags.
pub fn set_pause_flags(env: &Env, flags: &PauseFlags) {
    env.storage().instance().set(&DataKey::Paused, flags);
}

/// Set the pause reason. Pass `None` to clear (on unpause).
pub fn set_pause_reason(env: &Env, reason: Option<crate::types::PauseReason>) {
    match reason {
        Some(r) => env.storage().instance().set(&DataKey::PauseReason, &r),
        None => env.storage().instance().remove(&DataKey::PauseReason),
    }
}

/// Get the current pause reason. Returns `None` when unpaused or reason not set.
pub fn get_pause_reason(env: &Env) -> Option<crate::types::PauseReason> {
    env.storage().instance().get(&DataKey::PauseReason)
}

// ── Claim counter (instance) ──────────────────────────────────────────────────

pub fn get_claim_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::ClaimCounter)
        .unwrap_or(0u64)
}

pub fn next_claim_id(env: &Env) -> Result<u64, crate::validate::Error> {
    let next = get_claim_counter(env)
        .checked_add(1)
        .ok_or(crate::validate::Error::ClaimIdOverflow)?;
    env.storage().instance().set(&DataKey::ClaimCounter, &next);
    Ok(next)
}

// ── Voters (instance) ─────────────────────────────────────────────────────────

pub fn get_voters(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Voters)
        .unwrap_or_else(|| Vec::new(env))
}

/// Hard cap on the size of the voter registry. Enforced atomically across an
/// entire `add_voters_batch` call so a batch that would exceed the cap reverts
/// in full, leaving no partial writes.
pub const MAX_ELIGIBLE_VOTERS: u32 = 5_000;

/// Batch-register `addresses` as voters, skipping addresses already present
/// (in storage or earlier in the same batch) so duplicates cannot corrupt the
/// registry or double-count. The `MAX_ELIGIBLE_VOTERS` cap is checked against
/// the final, de-duplicated size of the registry *before* any write happens,
/// so a batch that would exceed the cap reverts atomically with zero partial
/// writes.
///
/// Returns the list of addresses actually added (in call order), which the
/// caller uses to emit one `VoterAdded` event per address.
pub fn add_voters_batch(env: &Env, addresses: &Vec<Address>) -> Result<Vec<Address>, ()> {
    let mut voters = get_voters(env);
    let mut to_add: Vec<Address> = Vec::new(env);

    for addr in addresses.iter() {
        let mut already_present = false;
        for v in voters.iter() {
            if v == addr {
                already_present = true;
                break;
            }
        }
        if !already_present {
            for v in to_add.iter() {
                if v == addr {
                    already_present = true;
                    break;
                }
            }
        }
        if !already_present {
            to_add.push_back(addr.clone());
        }
    }

    let projected_len = voters.len().saturating_add(to_add.len());
    if projected_len > MAX_ELIGIBLE_VOTERS {
        return Err(());
    }

    for addr in to_add.iter() {
        voters.push_back(addr.clone());
    }
    set_voters(env, &voters);

    Ok(to_add)
}

// ── Governance proposals ─────────────────────────────────────────────────────

pub fn next_proposal_id(env: &Env) -> u64 {
    let next = env
        .storage()
        .instance()
        .get::<_, u64>(&DataKey::ProposalCounter)
        .unwrap_or(0)
        .saturating_add(1);
    env.storage()
        .instance()
        .set(&DataKey::ProposalCounter, &next);
    next
}

pub fn set_proposal(env: &Env, proposal: &crate::governance::Proposal) {
    let key = DataKey::Proposal(proposal.proposal_id);
    env.storage().persistent().set(&key, proposal);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

pub fn get_proposal(env: &Env, proposal_id: u64) -> Option<crate::governance::Proposal> {
    env.storage()
        .persistent()
        .get(&DataKey::Proposal(proposal_id))
}

pub fn remove_proposal(env: &Env, proposal_id: u64) {
    env.storage()
        .persistent()
        .remove(&DataKey::Proposal(proposal_id));
}

pub fn set_proposal_vote(env: &Env, proposal_id: u64, voter: &Address, approve: bool) {
    let key = DataKey::ProposalVote(proposal_id, voter.clone());
    env.storage().persistent().set(&key, &approve);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

pub fn has_proposal_vote(env: &Env, proposal_id: u64, voter: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::ProposalVote(proposal_id, voter.clone()))
}

pub fn set_voters(env: &Env, voters: &Vec<Address>) {
    env.storage().instance().set(&DataKey::Voters, voters);
}

/// Add `holder` to the voter set (if not already present) and increment their
/// active-policy count by 1.
pub fn add_voter(env: &Env, holder: &Address) {
    let mut voters = get_voters(env);
    let mut found = false;
    for v in voters.iter() {
        if v == *holder {
            found = true;
            break;
        }
    }
    if !found {
        voters.push_back(holder.clone());
    }
    set_voters(env, &voters);

    let key = DataKey::ActivePolicyCount(holder.clone());
    let count: u32 = env.storage().instance().get(&key).unwrap_or(0);
    env.storage().instance().set(&key, &(count + 1));
}

pub fn increment_holder_active_policies(env: &Env, holder: &Address) {
    let key = DataKey::ActivePolicyCount(holder.clone());
    let count: u32 = env.storage().instance().get(&key).unwrap_or(0);
    env.storage().instance().set(&key, &(count + 1));
}

pub fn decrement_holder_active_policies(env: &Env, holder: &Address) {
    let key = DataKey::ActivePolicyCount(holder.clone());
    let next = get_active_policy_count(env, holder).saturating_sub(1);
    env.storage().instance().set(&key, &next);
}

pub fn get_holder_active_policy_count(env: &Env, holder: &Address) -> u32 {
    get_active_policy_count(env, holder)
}

pub fn voters_ensure_holder(env: &Env, holder: &Address) {
    let mut voters = get_voters(env);
    let mut found = false;
    for v in voters.iter() {
        if v == *holder {
            found = true;
            break;
        }
    }
    if !found {
        voters.push_back(holder.clone());
        set_voters(env, &voters);
    }
}

/// Removes `holder` from the voter list (no-op if absent).
pub fn remove_voter(env: &Env, holder: &Address) {
    let voters = get_voters(env);
    let mut updated: Vec<Address> = Vec::new(env);
    for v in voters.iter() {
        if v != *holder {
            updated.push_back(v);
        }
    }
    set_voters(env, &updated);
}

pub fn voters_remove_holder(env: &Env, holder: &Address) {
    remove_voter(env, holder);
}

/// Returns the number of active policies for `holder` (vote weight).
pub fn get_active_policy_count(env: &Env, holder: &Address) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::ActivePolicyCount(holder.clone()))
        .unwrap_or(0)
}

pub fn get_open_claim_count(env: &Env, holder: &Address, policy_id: u32) -> u32 {
    if has_open_claim(env, holder, policy_id) {
        1
    } else {
        0
    }
}

// ── Policy counter (persistent) ───────────────────────────────────────────────

pub fn get_policy_counter(env: &Env, holder: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::PolicyCounter(holder.clone()))
        .unwrap_or(0u32)
}

/// Atomically increment and return the next policy ID for a holder.
///
/// This function reads, increments, stores, and returns the policy ID counter
/// in a single operation to ensure atomicity and prevent duplicate IDs under
/// concurrent calls. The counter is stored in persistent storage per holder.
///
/// # Returns
/// The next sequential policy ID (u32) for the given holder.
///
/// # Storage
/// - Reads: `PolicyCounter(holder)` from persistent storage
/// - Writes: Increments and stores the new value
/// - Extends TTL to prevent eviction
pub fn next_policy_id(env: &Env, holder: &Address) -> u32 {
    let key = DataKey::PolicyCounter(holder.clone());
    let next: u32 = env.storage().persistent().get(&key).unwrap_or(0u32) + 1;
    env.storage().persistent().set(&key, &next);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
    next
}

// ── Policy (persistent) ───────────────────────────────────────────────────────

pub fn has_policy(env: &Env, holder: &Address, policy_id: u32) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Policy(holder.clone(), policy_id))
}

pub fn set_policy(env: &Env, holder: &Address, policy_id: u32, policy: &Policy) {
    let key = DataKey::Policy(holder.clone(), policy_id);
    env.storage().persistent().set(&key, policy);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

pub fn get_policy(env: &Env, holder: &Address, policy_id: u32) -> Option<Policy> {
    env.storage()
        .persistent()
        .get(&DataKey::Policy(holder.clone(), policy_id))
}

// ── Claim (persistent) ────────────────────────────────────────────────────────

pub fn set_claim(env: &Env, claim: &Claim) {
    let key = DataKey::Claim(claim.claim_id);
    env.storage().persistent().set(&key, claim);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

pub fn get_claim(env: &Env, claim_id: u64) -> Option<Claim> {
    env.storage().persistent().get(&DataKey::Claim(claim_id))
}

// ── Vote (persistent) ─────────────────────────────────────────────────────────

pub fn set_vote(env: &Env, claim_id: u64, voter: &Address, vote: &VoteOption) {
    let key = DataKey::Vote(claim_id, voter.clone());
    env.storage().persistent().set(&key, vote);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

pub fn get_vote(env: &Env, claim_id: u64, voter: &Address) -> Option<VoteOption> {
    env.storage()
        .persistent()
        .get(&DataKey::Vote(claim_id, voter.clone()))
}

// ── Vote delegations (instance) ───────────────────────────────────────────────

pub fn get_vote_delegations(env: &Env) -> Map<Address, VoteDelegation> {
    env.storage()
        .instance()
        .get(&DataKey::VoteDelegations)
        .unwrap_or_else(|| Map::new(env))
}

pub fn set_vote_delegations(env: &Env, delegations: &Map<Address, VoteDelegation>) {
    env.storage()
        .instance()
        .set(&DataKey::VoteDelegations, delegations);
}

pub fn get_vote_delegation(env: &Env, delegator: &Address) -> Option<VoteDelegation> {
    get_vote_delegations(env).get(delegator.clone())
}

pub fn set_vote_delegation(env: &Env, delegator: &Address, delegation: &VoteDelegation) {
    let mut delegations = get_vote_delegations(env);
    delegations.set(delegator.clone(), delegation.clone());
    set_vote_delegations(env, &delegations);
}

pub fn remove_vote_delegation(env: &Env, delegator: &Address) {
    let mut delegations = get_vote_delegations(env);
    if delegations.remove(delegator.clone()).is_some() {
        set_vote_delegations(env, &delegations);
    }
}

pub fn has_active_vote_delegation(env: &Env, delegator: &Address, now: u32) -> bool {
    get_vote_delegation(env, delegator)
        .map(|delegation| delegation.expiry_ledger >= now)
        .unwrap_or(false)
}

pub fn resolve_vote_delegation_target(
    env: &Env,
    start: &Address,
    now: u32,
) -> Result<Address, crate::validate::Error> {
    let mut current = start.clone();
    let mut seen: Vec<Address> = Vec::new(env);

    loop {
        if seen.iter().any(|addr| addr == current) {
            return Err(crate::validate::Error::CircularDelegation);
        }
        seen.push_back(current.clone());

        let Some(delegation) = get_vote_delegation(env, &current) else {
            return Ok(current);
        };

        if delegation.expiry_ledger < now {
            return Ok(current);
        }

        current = delegation.delegate;
    }
}

pub fn delegated_vote_weight(
    env: &Env,
    claim_id: u64,
    target: &Address,
    now: u32,
) -> Result<u32, crate::validate::Error> {
    let voters = get_claim_voters(env, claim_id);
    let mut total: u32 = 0;
    for voter in voters.iter() {
        let resolved = resolve_vote_delegation_target(env, &voter, now)?;
        if resolved == *target {
            total = total.saturating_add(get_active_policy_count(env, &voter));
        }
    }
    Ok(total)
}

// ── Claim voters snapshot (persistent) ───────────────────────────────────────

pub fn snapshot_claim_voters(env: &Env, claim_id: u64) {
    let voters = get_voters(env);
    let key = DataKey::ClaimVoters(claim_id);
    env.storage().persistent().set(&key, &voters);
    env.storage().persistent().extend_ttl(
        &key,
        CLAIM_VOTER_SNAPSHOT_TTL_THRESHOLD,
        CLAIM_VOTER_SNAPSHOT_EXTEND_TO,
    );
}

pub fn set_claim_voters(env: &Env, claim_id: u64, voters: &Vec<Address>) {
    let key = DataKey::ClaimVoters(claim_id);
    env.storage().persistent().set(&key, voters);
    env.storage().persistent().extend_ttl(
        &key,
        CLAIM_VOTER_SNAPSHOT_TTL_THRESHOLD,
        CLAIM_VOTER_SNAPSHOT_EXTEND_TO,
    );
}

/// `true` if the persistent `ClaimVoters` entry exists (not expired / evicted).
pub fn has_claim_voters(env: &Env, claim_id: u64) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::ClaimVoters(claim_id))
}

/// Extend TTL for the snapshot only; does not read or rewrite the voter list.
pub fn extend_claim_voters_snapshot_ttl(env: &Env, claim_id: u64) {
    let key = DataKey::ClaimVoters(claim_id);
    env.storage().persistent().extend_ttl(
        &key,
        CLAIM_VOTER_SNAPSHOT_TTL_THRESHOLD,
        CLAIM_VOTER_SNAPSHOT_EXTEND_TO,
    );
}

pub fn get_claim_voters(env: &Env, claim_id: u64) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::ClaimVoters(claim_id))
        .unwrap_or_else(|| Vec::new(env))
}

// ── Rate-limit anchor ─────────────────────────────────────────────────────────

pub fn set_last_claim_ledger(env: &Env, holder: &Address, ledger: u32) {
    let key = DataKey::LastClaimLedger(holder.clone());
    env.storage().persistent().set(&key, &ledger);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

pub fn get_last_claim_ledger(env: &Env, holder: &Address) -> Option<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::LastClaimLedger(holder.clone()))
}

pub fn remove_last_claim_ledger(env: &Env, holder: &Address) {
    let key = DataKey::LastClaimLedger(holder.clone());
    if env.storage().persistent().has(&key) {
        env.storage().persistent().remove(&key);
    }
}

/// Snapshot `LastClaimLedger` before filing (only written when `prev` is `Some`).
pub fn set_claim_rate_limit_prev(env: &Env, claim_id: u64, prev: Option<u32>) {
    if let Some(ledger) = prev {
        let key = DataKey::ClaimRateLimitPrev(claim_id);
        env.storage().persistent().set(&key, &ledger);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
    }
}

pub fn remove_claim_rate_limit_prev(env: &Env, claim_id: u64) {
    let key = DataKey::ClaimRateLimitPrev(claim_id);
    if env.storage().persistent().has(&key) {
        env.storage().persistent().remove(&key);
    }
}

/// Read and remove the rate-limit restore snapshot for `claim_id` (withdraw path).
pub fn take_claim_rate_limit_prev(env: &Env, claim_id: u64) -> Option<u32> {
    let key = DataKey::ClaimRateLimitPrev(claim_id);
    let v: Option<u32> = env.storage().persistent().get(&key);
    if env.storage().persistent().has(&key) {
        env.storage().persistent().remove(&key);
    }
    v
}

// ── Sweep cap (instance) ──────────────────────────────────────────────────────

/// Set optional per-transaction cap for emergency sweep operations.
/// None means no cap (unlimited sweep amount, subject to other constraints).
pub fn set_sweep_cap(env: &Env, cap: Option<i128>) {
    if let Some(c) = cap {
        env.storage().instance().set(&DataKey::SweepCap, &c);
    } else {
        env.storage().instance().remove(&DataKey::SweepCap);
    }
}

/// Get current sweep cap (None if not set).
pub fn get_sweep_cap(env: &Env) -> Option<i128> {
    env.storage().instance().get(&DataKey::SweepCap)
}

// ── Sweep notice period (instance) ───────────────────────────────────────────

/// Set the on-chain notice period (ledgers) required between sweep proposal and execution.
pub fn set_sweep_notice_period_ledgers(env: &Env, ledgers: u32) {
    env.storage()
        .instance()
        .set(&DataKey::SweepNoticePeriodLedgers, &ledgers);
}

/// Get the current sweep notice period in ledgers (0 = disabled).
pub fn get_sweep_notice_period_ledgers(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::SweepNoticePeriodLedgers)
        .unwrap_or(0u32)
}

// ── Max evidence count (instance) ────────────────────────────────────────────

/// Absolute hard maximum the admin setter will never exceed.
/// Prevents griefing via unbounded evidence storage.
pub const MAX_EVIDENCE_COUNT_HARD_MAX: u32 = 20;

/// Set admin-configurable max evidence entries per claim.
/// Caller must enforce `count <= MAX_EVIDENCE_COUNT_HARD_MAX`.
pub fn set_max_evidence_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&DataKey::MaxEvidenceCount, &count);
}

/// Current max evidence count. Falls back to compile-time [`crate::types::IMAGE_URLS_MAX`].
pub fn get_max_evidence_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::MaxEvidenceCount)
        .unwrap_or(crate::types::IMAGE_URLS_MAX)
}

// ── Min evidence count (instance) ────────────────────────────────────────────

/// Set admin-configurable minimum evidence entries required per claim.
/// Caller must enforce `min <= current max`.
pub fn set_min_evidence_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&DataKey::MinEvidenceCount, &count);
}

/// Current minimum evidence count. Falls back to 0 (no minimum) when unset.
pub fn get_min_evidence_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::MinEvidenceCount)
        .unwrap_or(0)
}

// ── Max weight cap (instance) ─────────────────────────────────────────────────

/// Set admin-configurable maximum vote weight cap for governance token voting.
pub fn set_max_weight_cap(env: &Env, cap: i128) {
    env.storage().instance().set(&DataKey::MaxWeightCap, &cap);
}

/// Current max weight cap. Falls back to `i128::MAX` (uncapped) when unset.
pub fn get_max_weight_cap(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::MaxWeightCap)
        .unwrap_or(i128::MAX)
}

// ── Claim filing fee (instance) ────────────────────────────────────────────

/// Set the flat fee (stroops) charged to the claimant at file_claim.
/// 0 = disabled. Fee is transferred to the treasury before claim creation.
pub fn set_claim_filing_fee(env: &Env, fee: i128) {
    env.storage().instance().set(&DataKey::ClaimFilingFee, &fee);
}

/// Get the current claim filing fee. Defaults to 0 (disabled) when unset.
pub fn get_claim_filing_fee(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::ClaimFilingFee)
        .unwrap_or(0)
}

// ── Per-policy cooldown (persistent) ─────────────────────────────────────────

/// Record the ledger at which the last claim for `(holder, policy_id)` was resolved.
pub fn set_last_claim_resolved_ledger(env: &Env, holder: &Address, policy_id: u32, ledger: u32) {
    let key = DataKey::LastClaimResolvedLedger(holder.clone(), policy_id);
    env.storage().persistent().set(&key, &ledger);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

/// Last resolved claim ledger for `(holder, policy_id)`. Returns `None` if no claim has been resolved.
pub fn get_last_claim_resolved_ledger(env: &Env, holder: &Address, policy_id: u32) -> Option<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::LastClaimResolvedLedger(holder.clone(), policy_id))
}

// ── Cooldown ledgers (instance) ───────────────────────────────────────────────

/// Set admin-configurable cooldown window in ledgers between claim resolutions per policy.
pub fn set_cooldown_ledgers(env: &Env, ledgers: u32) {
    env.storage()
        .instance()
        .set(&DataKey::CooldownLedgers, &ledgers);
}

/// Current cooldown window in ledgers. Falls back to 0 (no cooldown) when unset.
pub fn get_cooldown_ledgers(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::CooldownLedgers)
        .unwrap_or(0)
}

// ── Gateway allowlist (instance) ──────────────────────────────────────────────

/// Set the allowlisted IPFS gateway URL prefixes for evidence validation.
pub fn set_gateway_allowlist(env: &Env, gateways: &Vec<String>) {
    env.storage()
        .instance()
        .set(&DataKey::GatewayAllowlist, gateways);
}

/// Get the allowlisted IPFS gateway URL prefixes. Returns empty vec if not set.
pub fn get_gateway_allowlist(env: &Env) -> Vec<String> {
    env.storage()
        .instance()
        .get(&DataKey::GatewayAllowlist)
        .unwrap_or_else(|| Vec::new(env))
}

// ── Appeal vote (persistent) ──────────────────────────────────────────────────

pub fn set_appeal_vote(env: &Env, claim_id: u64, voter: &Address, vote: &VoteOption) {
    let key = DataKey::AppealVote(claim_id, voter.clone());
    env.storage().persistent().set(&key, vote);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

pub fn get_appeal_vote(env: &Env, claim_id: u64, voter: &Address) -> Option<VoteOption> {
    env.storage()
        .persistent()
        .get(&DataKey::AppealVote(claim_id, voter.clone()))
}

// ── Rolling claim cap (instance + persistent) ─────────────────────────────────

pub fn set_rolling_claim_cap(env: &Env, cap: i128) {
    env.storage()
        .instance()
        .set(&DataKey::RollingClaimCap, &cap);
}

pub fn get_rolling_claim_cap(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::RollingClaimCap)
        .unwrap_or(i128::MAX)
}

pub fn set_rolling_claim_window_ledgers(env: &Env, w: u32) {
    env.storage()
        .instance()
        .set(&DataKey::RollingClaimWindowLedgers, &w);
}

pub fn get_rolling_claim_window_ledgers(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::RollingClaimWindowLedgers)
        .unwrap_or(1_000_000)
}

pub fn get_rolling_claim_state(
    env: &Env,
    holder: &Address,
    policy_id: u32,
) -> Option<RollingClaimWindowState> {
    env.storage()
        .persistent()
        .get(&DataKey::RollingClaimState(holder.clone(), policy_id))
}

pub fn set_rolling_claim_state(
    env: &Env,
    holder: &Address,
    policy_id: u32,
    state: &RollingClaimWindowState,
) {
    let key = DataKey::RollingClaimState(holder.clone(), policy_id);
    env.storage().persistent().set(&key, state);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

// ── Policy expiry notification (instance) ─────────────────────────────────────

/// Last `end_ledger` for which `PolicyExpired` was emitted for this policy term.
pub fn get_policy_expired_event_end_ledger(
    env: &Env,
    holder: &Address,
    policy_id: u32,
) -> Option<u32> {
    env.storage()
        .instance()
        .get(&DataKey::PolicyExpiredEventEndLedger(
            holder.clone(),
            policy_id,
        ))
}

pub fn set_policy_expired_event_end_ledger(
    env: &Env,
    holder: &Address,
    policy_id: u32,
    end_ledger: u32,
) {
    env.storage().instance().set(
        &DataKey::PolicyExpiredEventEndLedger(holder.clone(), policy_id),
        &end_ledger,
    );
}

// ── Per-holder replay-protection nonce (persistent) ──────────────────────────
//
// Supplementary to Stellar's native sequence numbers. Opt-in: callers that
// don't supply `expected_nonce` skip the check entirely. Storage is per-holder
// persistent entry — one u64 per unique holder, no unbounded growth beyond the
// holder set itself (which is already tracked in `Voters`).

pub fn get_holder_nonce(env: &Env, holder: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::HolderNonce(holder.clone()))
        .unwrap_or(0u64)
}

/// Increment and persist the nonce, returning the new value.
pub fn increment_holder_nonce(env: &Env, holder: &Address) -> u64 {
    let next = get_holder_nonce(env, holder)
        .checked_add(1)
        .unwrap_or_else(|| panic!("holder nonce overflow"));
    let key = DataKey::HolderNonce(holder.clone());
    env.storage().persistent().set(&key, &next);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
    next
}

/// Check `expected` against the current nonce; return `Err` on mismatch.
/// No-op (returns `Ok`) when `expected` is `None`.
pub fn check_and_bump_nonce(
    env: &Env,
    holder: &Address,
    expected: Option<u64>,
) -> Result<(), crate::validate::Error> {
    if let Some(exp) = expected {
        let current = get_holder_nonce(env, holder);
        if exp != current {
            return Err(crate::validate::Error::NonceMismatch);
        }
    }
    increment_holder_nonce(env, holder);
    Ok(())
}

// ── Oracle / parametric trigger storage (experimental) ───────────────────────

#[cfg(feature = "experimental")]
pub fn next_trigger_id(env: &Env) -> u64 {
    let key = DataKey::TriggerCounter;
    let next: u64 = env.storage().instance().get(&key).unwrap_or(0u64) + 1;
    env.storage().instance().set(&key, &next);
    next
}

#[cfg(feature = "experimental")]
pub fn set_oracle_trigger(env: &Env, trigger_id: u64, trigger: &crate::types::OracleTrigger) {
    let key = DataKey::OracleTrigger(trigger_id);
    env.storage().persistent().set(&key, trigger);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

#[cfg(feature = "experimental")]
pub fn get_oracle_trigger(env: &Env, trigger_id: u64) -> Option<crate::types::OracleTrigger> {
    env.storage()
        .persistent()
        .get(&DataKey::OracleTrigger(trigger_id))
}

#[cfg(feature = "experimental")]
pub fn set_trigger_status(env: &Env, trigger_id: u64, status: crate::types::TriggerStatus) {
    env.storage()
        .instance()
        .set(&DataKey::TriggerStatus(trigger_id), &status);
}

#[cfg(feature = "experimental")]
pub fn get_trigger_status(env: &Env, trigger_id: u64) -> Option<crate::types::TriggerStatus> {
    env.storage()
        .instance()
        .get(&DataKey::TriggerStatus(trigger_id))
}

#[cfg(feature = "experimental")]
pub fn set_oracle_enabled(env: &Env, enabled: bool) {
    env.storage()
        .instance()
        .set(&DataKey::OracleEnabled, &enabled);
}

#[cfg(feature = "experimental")]
pub fn is_oracle_enabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::OracleEnabled)
        .unwrap_or(false)
}

/// Register an Ed25519 public key for an oracle source address.
#[cfg(feature = "experimental")]
pub fn set_oracle_pub_key(env: &Env, source: &Address, pub_key: &soroban_sdk::BytesN<32>) {
    env.storage()
        .instance()
        .set(&DataKey::OraclePubKey(source.clone()), pub_key);
}

#[cfg(feature = "experimental")]
pub fn get_oracle_pub_key(env: &Env, source: &Address) -> Option<soroban_sdk::BytesN<32>> {
    env.storage()
        .instance()
        .get(&DataKey::OraclePubKey(source.clone()))
}

/// Get the last accepted nonce for an oracle source (0 if never used).
#[cfg(feature = "experimental")]
pub fn get_oracle_nonce(env: &Env, source: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::OracleNonce(source.clone()))
        .unwrap_or(0u64)
}

/// Advance the oracle nonce. Returns Err if `nonce` is not strictly greater than current.
#[cfg(feature = "experimental")]
pub fn advance_oracle_nonce(
    env: &Env,
    source: &Address,
    nonce: u64,
) -> Result<(), crate::validate::OracleError> {
    let current = get_oracle_nonce(env, source);
    if nonce <= current {
        return Err(crate::validate::OracleError::ReplayedNonce);
    }
    let key = DataKey::OracleNonce(source.clone());
    env.storage().persistent().set(&key, &nonce);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
    Ok(())
}

/// Required number of oracle signatures for a source (0 or 1 = single-sig).
#[cfg(feature = "experimental")]
pub fn get_oracle_quorum(env: &Env, source: &Address) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::OracleQuorum(source.clone()))
        .unwrap_or(1u32)
}

#[cfg(feature = "experimental")]
pub fn set_oracle_quorum(env: &Env, source: &Address, quorum: u32) {
    env.storage()
        .instance()
        .set(&DataKey::OracleQuorum(source.clone()), &quorum);
}

// ── Keeper TTL Management ─────────────────────────────────────────────────────

/// Configurable threshold for TTL expiry alerts (instance storage).
/// Default: 10% of PERSISTENT_TTL_EXTEND_TO (600,000 ledgers ~ 1 month).
pub const DEFAULT_TTL_ALERT_THRESHOLD: u32 = 600_000;

/// Get the configured TTL alert threshold. Returns default if not set.
pub fn get_ttl_alert_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::TtlAlertThreshold)
        .unwrap_or(DEFAULT_TTL_ALERT_THRESHOLD)
}

/// Set the TTL alert threshold (admin only).
pub fn set_ttl_alert_threshold(env: &Env, threshold: u32) {
    env.storage()
        .instance()
        .set(&DataKey::TtlAlertThreshold, &threshold);
}

/// Check if a policy's TTL is within the alert threshold.
/// Returns true if the policy entry exists and its TTL has been extended recently.
/// NOTE: soroban-sdk does not expose a raw TTL read API; this is a presence check only.
/// Off-chain monitoring should use the Stellar RPC `getLedgerEntries` to read actual TTL.
pub fn is_policy_ttl_near_expiry(_env: &Env, _holder: &Address, _policy_id: u32) -> bool {
    // TTL introspection is not available in soroban-sdk 25.x on-chain.
    // Use off-chain RPC monitoring (getLedgerEntries) to check remaining TTL.
    false
}

/// Extend TTL for a specific policy and its related entries.
/// Keeper function to prevent data loss for long-lived policies.
pub fn bump_policy_ttl(env: &Env, holder: &Address, policy_id: u32) -> bool {
    let policy_key = DataKey::Policy(holder.clone(), policy_id);

    if !env.storage().persistent().has(&policy_key) {
        return false;
    }

    env.storage().persistent().extend_ttl(
        &policy_key,
        PERSISTENT_TTL_THRESHOLD,
        PERSISTENT_TTL_EXTEND_TO,
    );

    let counter_key = DataKey::PolicyCounter(holder.clone());
    env.storage().persistent().extend_ttl(
        &counter_key,
        PERSISTENT_TTL_THRESHOLD,
        PERSISTENT_TTL_EXTEND_TO,
    );

    true
}

/// Extend TTL for all policies belonging to a holder.
/// Returns number of policies extended.
pub fn bump_holder_all_policies_ttl(env: &Env, holder: &Address) -> u32 {
    let counter = get_policy_counter(env, holder);
    let mut extended = 0u32;

    for policy_id in 1..=counter {
        if bump_policy_ttl(env, holder, policy_id) {
            extended += 1;
        }
    }

    extended
}

/// Extend TTL for all claim-related entries for a specific claim.
pub fn bump_claim_ttl(env: &Env, claim_id: u64) -> bool {
    let claim_key = DataKey::Claim(claim_id);

    if !env.storage().persistent().has(&claim_key) {
        return false;
    }

    env.storage().persistent().extend_ttl(
        &claim_key,
        PERSISTENT_TTL_THRESHOLD,
        PERSISTENT_TTL_EXTEND_TO,
    );

    extend_claim_voters_snapshot_ttl(env, claim_id);

    let quorum_key = DataKey::ClaimQuorumBps(claim_id);
    if env.storage().persistent().has(&quorum_key) {
        env.storage().persistent().extend_ttl(
            &quorum_key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
    }

    true
}

/// Returns `true` if the policy persistent entry exists (not expired / evicted).
/// Use off-chain RPC `getLedgerEntries` to read the actual remaining TTL value.
pub fn get_policy_ttl_info(env: &Env, holder: &Address, policy_id: u32) -> Option<u32> {
    let key = DataKey::Policy(holder.clone(), policy_id);
    if env.storage().persistent().has(&key) {
        Some(PERSISTENT_TTL_EXTEND_TO)
    } else {
        None
    }
}

/// Returns `true` if the claim persistent entry exists (not expired / evicted).
/// Use off-chain RPC `getLedgerEntries` to read the actual remaining TTL value.
pub fn get_claim_ttl_info(env: &Env, claim_id: u64) -> Option<u32> {
    let key = DataKey::Claim(claim_id);
    if env.storage().persistent().has(&key) {
        Some(PERSISTENT_TTL_EXTEND_TO)
    } else {
        None
    }
}

// ── Policy type registry (instance) ──────────────────────────────────────────

/// Get the admin-configured settings for a policy type.
/// Returns `None` when no config has been set (all defaults apply).
pub fn get_policy_type_config(
    env: &Env,
    policy_type: &crate::types::PolicyType,
) -> Option<crate::types::PolicyTypeConfig> {
    env.storage()
        .instance()
        .get(&DataKey::PolicyTypeConfig(policy_type.clone()))
}

/// Persist admin-configured settings for a policy type.
pub fn set_policy_type_config(
    env: &Env,
    policy_type: &crate::types::PolicyType,
    config: &crate::types::PolicyTypeConfig,
) {
    env.storage()
        .instance()
        .set(&DataKey::PolicyTypeConfig(policy_type.clone()), config);
}

/// Returns `true` if the policy type is registered and active in the registry.
pub fn is_policy_type_active(env: &Env, policy_type: &crate::types::PolicyType) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::PolicyTypeActive(policy_type.clone()))
        .unwrap_or(false)
}

/// Set the active flag for a policy type in the registry.
pub fn set_policy_type_active(env: &Env, policy_type: &crate::types::PolicyType, active: bool) {
    env.storage()
        .instance()
        .set(&DataKey::PolicyTypeActive(policy_type.clone()), &active);
    // Mark the registry as enabled on first registration.
    if active {
        env.storage()
            .instance()
            .set(&DataKey::PolicyTypeRegistryEnabled, &true);
    }
}

/// Returns `true` if the policy type registry has been activated (at least one type registered).
pub fn is_policy_type_registry_enabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::PolicyTypeRegistryEnabled)
        .unwrap_or(false)
}

// ── Per-asset premium table (instance) ───────────────────────────────────────

/// Get the asset-specific multiplier table for `asset`.
/// Returns `None` when no asset-specific table has been set (caller should fall back to default).
pub fn get_asset_premium_table(
    env: &Env,
    asset: &Address,
) -> Option<crate::types::MultiplierTable> {
    env.storage()
        .instance()
        .get(&DataKey::AssetPremiumTable(asset.clone()))
}

/// Persist an asset-specific multiplier table.
pub fn set_asset_premium_table(env: &Env, asset: &Address, table: &crate::types::MultiplierTable) {
    env.storage()
        .instance()
        .set(&DataKey::AssetPremiumTable(asset.clone()), table);
}

/// Remove an asset-specific multiplier table (reverts to global default).
pub fn remove_asset_premium_table(env: &Env, asset: &Address) {
    env.storage()
        .instance()
        .remove(&DataKey::AssetPremiumTable(asset.clone()));
}

// ── Non-experimental stubs (panic guards) ────────────────────────────────────

#[cfg(not(feature = "experimental"))]
pub fn next_trigger_id(_env: &Env) -> u64 {
    panic!("ORACLE_TRIGGERS_DISABLED")
}

#[cfg(not(feature = "experimental"))]
pub fn set_oracle_trigger(_env: &Env, _id: u64, _trigger: &crate::types::OracleTrigger) {
    panic!("ORACLE_TRIGGERS_DISABLED")
}

#[cfg(not(feature = "experimental"))]
pub fn get_oracle_trigger(_env: &Env, _id: u64) -> Option<crate::types::OracleTrigger> {
    panic!("ORACLE_TRIGGERS_DISABLED")
}

#[cfg(not(feature = "experimental"))]
pub fn set_trigger_status(_env: &Env, _id: u64, _status: crate::types::TriggerStatus) {
    panic!("ORACLE_TRIGGERS_DISABLED")
}

#[cfg(not(feature = "experimental"))]
pub fn get_trigger_status(_env: &Env, _id: u64) -> Option<crate::types::TriggerStatus> {
    panic!("ORACLE_TRIGGERS_DISABLED")
}

#[cfg(not(feature = "experimental"))]
pub fn is_oracle_enabled(_env: &Env) -> bool {
    panic!("ORACLE_TRIGGERS_DISABLED")
}

#[cfg(not(feature = "experimental"))]
pub fn set_oracle_enabled(_env: &Env, _enabled: bool) {
    panic!("ORACLE_TRIGGERS_DISABLED")
}

// ── Issue #583: Claim fraud score ─────────────────────────────────────────────

pub fn set_claim_fraud_score(env: &Env, claim_id: u64, score: u32) {
    let key = DataKey::ClaimFraudScore(claim_id);
    env.storage().persistent().set(&key, &score);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

pub fn get_claim_fraud_score(env: &Env, claim_id: u64) -> Option<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::ClaimFraudScore(claim_id))
}

pub fn set_fraud_score_threshold(env: &Env, threshold: u32) {
    env.storage()
        .instance()
        .set(&DataKey::FraudScoreThreshold, &threshold);
}

/// Threshold above which elevated quorum is required. Default: 75.
pub fn get_fraud_score_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::FraudScoreThreshold)
        .unwrap_or(75u32)
}

pub fn set_elevated_quorum_bps(env: &Env, bps: u32) {
    env.storage()
        .instance()
        .set(&DataKey::ElevatedQuorumBps, &bps);
}

/// Elevated quorum bps used when fraud score exceeds threshold. Default: 7500 (75%).
pub fn get_elevated_quorum_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::ElevatedQuorumBps)
        .unwrap_or(7500u32)
}

// ── Issue #587: Asset-specific claim amount bounds ────────────────────────────

pub fn set_allowed_asset_config(
    env: &Env,
    asset: &Address,
    config: &crate::types::AllowedAssetConfig,
) {
    env.storage()
        .instance()
        .set(&DataKey::AllowedAssetConfig(asset.clone()), config);
}

pub fn get_allowed_asset_config(
    env: &Env,
    asset: &Address,
) -> Option<crate::types::AllowedAssetConfig> {
    env.storage()
        .instance()
        .get(&DataKey::AllowedAssetConfig(asset.clone()))
}

// ── Issue #585: Admin role delegation ────────────────────────────────────────

pub fn set_delegation(env: &Env, operator: &Address, record: &crate::types::DelegationRecord) {
    env.storage()
        .instance()
        .set(&DataKey::Delegation(operator.clone()), record);
}

pub fn get_delegation(env: &Env, operator: &Address) -> Option<crate::types::DelegationRecord> {
    env.storage()
        .instance()
        .get(&DataKey::Delegation(operator.clone()))
}

pub fn remove_delegation(env: &Env, operator: &Address) {
    env.storage()
        .instance()
        .remove(&DataKey::Delegation(operator.clone()));
}

fn get_delegation_operator_index(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::DelegationOperatorIndex)
        .unwrap_or_else(|| Vec::new(env))
}

fn set_delegation_operator_index(env: &Env, index: &Vec<Address>) {
    env.storage()
        .instance()
        .set(&DataKey::DelegationOperatorIndex, index);
}

/// Insert `operator` into the delegation index if not already present.
pub fn index_delegation_operator(env: &Env, operator: &Address) {
    let mut index = get_delegation_operator_index(env);
    for i in 0..index.len() {
        if index.get(i).as_ref() == Some(operator) {
            return;
        }
    }
    index.push_back(operator.clone());
    set_delegation_operator_index(env, &index);
}

/// Remove `operator` from the delegation index (no-op if absent).
pub fn unindex_delegation_operator(env: &Env, operator: &Address) {
    let index = get_delegation_operator_index(env);
    let mut next: Vec<Address> = Vec::new(env);
    for i in 0..index.len() {
        if let Some(addr) = index.get(i) {
            if &addr != operator {
                next.push_back(addr);
            }
        }
    }
    set_delegation_operator_index(env, &next);
}

// ── Issue #581: Reinsurance pool ──────────────────────────────────────────────

pub fn set_reinsurance_contract(env: &Env, addr: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::ReinsuranceContract, addr);
}

pub fn get_reinsurance_contract(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::ReinsuranceContract)
}

pub fn clear_reinsurance_contract(env: &Env) {
    env.storage()
        .instance()
        .remove(&DataKey::ReinsuranceContract);
}

// ── Appeal mechanism — voter snapshot (persistent) ────────────────────────────
//
// A fresh snapshot is taken at appeal-open time so voter eligibility is
// evaluated against the registry at that moment, not at the original filing.
// The snapshot TTL mirrors the claim-voter snapshot constants since appeal
// windows are the same length as base vote windows.

/// Capture the current voter registry as the appeal-round electorate.
pub fn snapshot_appeal_voters(env: &Env, claim_id: u64) {
    let voters = get_voters(env);
    let key = DataKey::AppealVoters(claim_id);
    env.storage().persistent().set(&key, &voters);
    env.storage().persistent().extend_ttl(
        &key,
        CLAIM_VOTER_SNAPSHOT_TTL_THRESHOLD,
        CLAIM_VOTER_SNAPSHOT_EXTEND_TO,
    );
}

/// Returns `true` if the appeal voter snapshot entry still exists.
pub fn has_appeal_voters(env: &Env, claim_id: u64) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::AppealVoters(claim_id))
}

/// Retrieve the appeal voter snapshot, returning empty vec if expired.
pub fn get_appeal_voters(env: &Env, claim_id: u64) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::AppealVoters(claim_id))
        .unwrap_or_else(|| Vec::new(env))
}

// ── Appeal mechanism — quorum snapshot (persistent) ───────────────────────────

/// Persist the elevated quorum bps for this claim's appeal round (immutable after open_appeal).
pub fn set_appeal_claim_quorum_bps(env: &Env, claim_id: u64, bps: u32) {
    let key = DataKey::AppealClaimQuorumBps(claim_id);
    env.storage().persistent().set(&key, &bps);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

/// Retrieve the appeal-round quorum snapshot. Falls back to elevated default when missing.
pub fn get_appeal_claim_quorum_bps(env: &Env, claim_id: u64) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::AppealClaimQuorumBps(claim_id))
        .unwrap_or(crate::claim::APPEAL_ELEVATED_QUORUM_BPS)
}

// ── KYC whitelist (Issue #2) ──────────────────────────────────────────────────
// `PolicyError::NotWhitelisted` unless the holder is in the whitelist map.
// When `false`, the whitelist map is ignored and all addresses may bind policies.
//
// Storage layout:
//   `WhitelistEnabled` (instance bool) — fast single-read enforcement toggle.
//   `Whitelisted(address)` (instance bool) — per-address presence flag.
//     Instance storage is appropriate here because the whitelist is expected to
//     be a bounded, frequently-read set (KYC approvals, not unbounded data).

/// Returns `true` if whitelist enforcement is currently active.
pub fn is_whitelist_enabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::WhitelistEnabled)
        .unwrap_or(false)
}

/// Admin-only: enable or disable whitelist enforcement.
pub fn set_whitelist_enabled(env: &Env, enabled: bool) {
    env.storage()
        .instance()
        .set(&DataKey::WhitelistEnabled, &enabled);
}

/// Returns `true` if `holder` is on the whitelist (regardless of enforcement state).
pub fn is_whitelisted(env: &Env, holder: &Address) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Whitelisted(holder.clone()))
        .unwrap_or(false)
}

/// Add or remove an address from the whitelist.
pub fn set_whitelisted(env: &Env, holder: &Address, allowed: bool) {
    if allowed {
        env.storage()
            .instance()
            .set(&DataKey::Whitelisted(holder.clone()), &true);
    } else {
        env.storage()
            .instance()
            .remove(&DataKey::Whitelisted(holder.clone()));
    }
}

// ── Region registry ───────────────────────────────────────────────────────────

pub fn get_region_registry(env: &Env) -> Map<String, crate::types::RegionConfig> {
    env.storage()
        .instance()
        .get(&DataKey::RegionRegistry)
        .unwrap_or_else(|| Map::new(env))
}

pub fn set_region_registry(env: &Env, registry: &Map<String, crate::types::RegionConfig>) {
    env.storage()
        .instance()
        .set(&DataKey::RegionRegistry, registry);
}

pub fn get_region_config(env: &Env, code: &String) -> Option<crate::types::RegionConfig> {
    get_region_registry(env).get(code.clone())
}

// ── Treatment tracking ──────────────────────────────────────────────────────

pub fn increment_treatment_count(env: &Env, pet_id: u64) -> u64 {
    let key = DataKey::TreatmentCount(pet_id);
    let count: u64 = env.storage().persistent().get(&key).unwrap_or(0);
    let next = count.saturating_add(1);
    env.storage().persistent().set(&key, &next);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
    next
}

pub fn get_treatment_count(env: &Env, pet_id: u64) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::TreatmentCount(pet_id))
        .unwrap_or(0)
}

// ── Vet specialization registry ─────────────────────────────────────────────

pub fn set_vet_specializations(
    env: &Env,
    vet: &Address,
    specializations: &Vec<crate::types::Specialization>,
) {
    env.storage()
        .instance()
        .set(&DataKey::VetSpecializations(vet.clone()), specializations);
}

pub fn get_vet_specializations(env: &Env, vet: &Address) -> Vec<crate::types::Specialization> {
    env.storage()
        .instance()
        .get(&DataKey::VetSpecializations(vet.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn vet_has_specialization(
    env: &Env,
    vet: &Address,
    required: &crate::types::Specialization,
) -> bool {
    get_vet_specializations(env, vet).contains(required)
}

// ── Event subscription filter system ──────────────────────────────────────────

pub fn next_subscription_id(env: &Env) -> u64 {
    let next: u64 = env
        .storage()
        .instance()
        .get(&DataKey::SubscriptionCounter)
        .unwrap_or(0)
        + 1;
    env.storage()
        .instance()
        .set(&DataKey::SubscriptionCounter, &next);
    next
}

pub fn set_subscription(env: &Env, sub: &crate::types::Subscription) {
    let key = DataKey::Subscription(sub.id);
    env.storage().persistent().set(&key, sub);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

pub fn get_subscription(env: &Env, id: u64) -> Option<crate::types::Subscription> {
    env.storage().persistent().get(&DataKey::Subscription(id))
}

pub fn remove_subscription(env: &Env, id: u64) {
    env.storage()
        .persistent()
        .remove(&DataKey::Subscription(id));
}

pub fn get_owner_subscription_ids(env: &Env, owner: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::OwnerSubscriptionIds(owner.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_owner_subscription_ids(env: &Env, owner: &Address, ids: &Vec<u64>) {
    let key = DataKey::OwnerSubscriptionIds(owner.clone());
    env.storage().persistent().set(&key, ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

// ── Treasury depositor allowlist ──────────────────────────────────────────────

pub fn is_authorized_depositor(env: &Env, depositor: &Address) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::AuthorizedDepositor(depositor.clone()))
        .unwrap_or(false)
}

pub fn set_authorized_depositor(env: &Env, depositor: &Address, allowed: bool) {
    env.storage()
        .instance()
        .set(&DataKey::AuthorizedDepositor(depositor.clone()), &allowed);
}

// ── Contract payout recipient allowlist ───────────────────────────────────────

pub fn is_allowed_payout_recipient(env: &Env, recipient: &Address) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::AllowedPayoutRecipient(recipient.clone()))
        .unwrap_or(false)
}

pub fn set_allowed_payout_recipient(env: &Env, recipient: &Address, allowed: bool) {
    env.storage().instance().set(
        &DataKey::AllowedPayoutRecipient(recipient.clone()),
        &allowed,
    );
}

// ── Governance cooldown (Issue #844) ──────────────────────────────────────

pub fn set_governance_cooldown_ledgers(env: &Env, ledgers: u32) {
    env.storage()
        .instance()
        .set(&DataKey::GovernanceCooldownLedgers, &ledgers);
}

pub fn get_governance_cooldown_ledgers(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::GovernanceCooldownLedgers)
        .unwrap_or(0)
}

pub fn set_last_param_change_ledger(env: &Env, ledger: u32) {
    env.storage()
        .instance()
        .set(&DataKey::LastParamChangeLedger, &ledger);
}

pub fn get_last_param_change_ledger(env: &Env) -> Option<u32> {
    env.storage()
        .instance()
        .get(&DataKey::LastParamChangeLedger)
}

// ── Treasury withdrawal limit (Issue #845) ────────────────────────────────

pub fn set_max_sweep_per_ledger(env: &Env, cap: i128) {
    env.storage()
        .instance()
        .set(&DataKey::MaxSweepPerLedger, &cap);
}

pub fn get_max_sweep_per_ledger(env: &Env) -> Option<i128> {
    env.storage().instance().get(&DataKey::MaxSweepPerLedger)
}

pub fn set_last_sweep_ledger(env: &Env, ledger: u32) {
    env.storage()
        .instance()
        .set(&DataKey::LastSweepLedger, &ledger);
}

pub fn get_last_sweep_ledger(env: &Env) -> Option<u32> {
    env.storage().instance().get(&DataKey::LastSweepLedger)
}

pub fn set_cumulative_swept_this_ledger(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::CumulativeSweptThisLedger, &amount);
}

pub fn get_cumulative_swept_this_ledger(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::CumulativeSweptThisLedger)
        .unwrap_or(0)
}

// ── Ledger close time estimate (Issue #842) ───────────────────────────────────
//
// Returns the admin-configured seconds-per-ledger estimate used by the UI
// to convert ledger sequence numbers to approximate wall-clock deadlines.
//
// NOTE: This is an **estimate only**. Actual Stellar ledger close times vary
// between approximately 3–7 seconds depending on network conditions. This
// value MUST NOT be used for on-chain enforcement — only for UX display.

/// Set the admin-configurable seconds-per-ledger estimate.
/// Caller must validate range before calling (recommend 1–30).
pub fn set_secs_per_ledger_estimate(env: &Env, secs: u32) {
    env.storage()
        .instance()
        .set(&DataKey::SecsPerLedgerEstimate, &secs);
}

/// Get the configured seconds-per-ledger estimate.
/// Returns [`crate::ledger::SECS_PER_LEDGER`] (5) when not explicitly set.
///
/// NOTE: This is an **estimate** — actual ledger close times vary. Do not
/// use for legal deadlines or on-chain enforcement.
pub fn get_secs_per_ledger_estimate(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::SecsPerLedgerEstimate)
        .unwrap_or(crate::ledger::SECS_PER_LEDGER)
}

// ── Admin role separation (Issue #1161) ───────────────────────────────────────
//
// Three scoped roles supplement the single admin key:
//   - PauseAdmin   : may call pause / unpause only.
//   - TreasuryAdmin: may call drain, sweep, and treasury-rotation operations.
//   - ParamAdmin   : may call governance parameter changes (evidence count, cooldowns, …).
//
// When a role is unset, the main Admin address is accepted as a fallback so
// that existing single-admin deployments continue to work without re-configuration.

pub fn set_pause_admin(env: &Env, addr: &Address) {
    env.storage().instance().set(&DataKey::PauseAdmin, addr);
}

pub fn get_pause_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::PauseAdmin)
}

pub fn set_treasury_admin(env: &Env, addr: &Address) {
    env.storage().instance().set(&DataKey::TreasuryAdmin, addr);
}

pub fn get_treasury_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::TreasuryAdmin)
}

pub fn set_param_admin(env: &Env, addr: &Address) {
    env.storage().instance().set(&DataKey::ParamAdmin, addr);
}

pub fn get_param_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::ParamAdmin)
}

// ── Issue #787: Coverage amount floor (instance) ─────────────────────────────

/// Default safe minimum: 1_000_000 stroops (0.1 XLM equivalent).
pub const DEFAULT_MIN_COVERAGE_AMOUNT: i128 = 1_000_000;

pub fn set_min_coverage_amount(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::MinCoverageAmount, &amount);
}

pub fn get_min_coverage_amount(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::MinCoverageAmount)
        .unwrap_or(DEFAULT_MIN_COVERAGE_AMOUNT)
}

// ── Issue #783: Voter count hard cap (instance) ───────────────────────────────

/// Default safe cap: 100 voters per claim.
pub const DEFAULT_MAX_VOTERS_PER_CLAIM: u32 = 100;

pub fn set_max_voters_per_claim(env: &Env, cap: u32) {
    env.storage()
        .instance()
        .set(&DataKey::MaxVotersPerClaim, &cap);
}

pub fn get_max_voters_per_claim(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::MaxVotersPerClaim)
        .unwrap_or(DEFAULT_MAX_VOTERS_PER_CLAIM)
}

// ── Issue #782: Token decimal normalization (instance) ────────────────────────

pub fn set_asset_decimals(env: &Env, asset: &Address, decimals: u32) {
    env.storage()
        .instance()
        .set(&DataKey::AssetDecimals(asset.clone()), &decimals);
}

pub fn get_asset_decimals(env: &Env, asset: &Address) -> Option<u32> {
    env.storage()
        .instance()
        .get(&DataKey::AssetDecimals(asset.clone()))
}
