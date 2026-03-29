use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::ledger;
use crate::types::{Claim, MultiplierTable, Policy, VoteOption};

// ── TTL constants ─────────────────────────────────────────────────────────────
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
    Token,
    /// Address where collected premiums are sent.
    Treasury,
    PremiumTable,
    CalcAddress,
    /// Boolean allowlist flag per asset contract address.
    AllowedAsset(Address),
    Voters,
    ClaimCounter,
    Paused,
    ActivePolicyCount(Address),
    /// Optional per-transaction cap for emergency sweep operations (i128).
    SweepCap,
    /// Max total **paid** claim amount per policy per rolling ledger window (gross `claim.amount`).
    RollingClaimCap,
    /// Ledger length of each rolling window (bucket alignment uses current ledger sequence).
    RollingClaimWindowLedgers,
    /// Admin-configurable max evidence entries per claim (u32).
    /// Falls back to [`IMAGE_URLS_MAX`] when unset.
    MaxEvidenceCount,
    // ── Reserved: future governance token (`governance_token` module) ────────
    /// Runtime toggle: only meaningful when crate is built with `governance-token`.
    /// Unset or `false` in MVP; no token logic runs unless feature + flag align.
    GovernanceTokenRuntimeEnabled,
    /// Future token contract address (stub storage only; no transfers in this crate yet).
    GovernanceTokenAddress,
    /// Future schema / migration version for governance-token config.
    GovernanceTokenConfigVersion,
    // ── Persistent tier ──────────────────────────────────────────────────
    Policy(Address, u32),
    PolicyCounter(Address),
    Claim(u64),
    /// Temp key for open claim check (policy_holder, policy_id) -> bool
    OpenClaim(Address, u32),
    /// (claim_id, voter_address) -> VoteOption; immutable after first write
    Vote(u64, Address),
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
}

// ── Instance bump ─────────────────────────────────────────────────────────────

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

pub fn clear_pending_admin(env: &Env) {
    env.storage().instance().remove(&DataKey::PendingAdmin);
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

// ── Claim counter (instance) ──────────────────────────────────────────────────

pub fn get_claim_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::ClaimCounter)
        .unwrap_or(0u64)
}

pub fn next_claim_id(env: &Env) -> u64 {
    let next = get_claim_counter(env)
        .checked_add(1)
        .unwrap_or_else(|| panic!("claim_id overflow"));
    env.storage().instance().set(&DataKey::ClaimCounter, &next);
    next
}

// ── Voters (instance) ─────────────────────────────────────────────────────────

pub fn get_voters(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Voters)
        .unwrap_or_else(|| Vec::new(env))
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
    env.storage()
        .persistent()
        .set(&DataKey::LastClaimLedger(holder.clone()), &ledger);
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
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
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
    env.storage().instance().set(&DataKey::RollingClaimCap, &cap);
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
    env.storage().persistent().get(&DataKey::RollingClaimState(
        holder.clone(),
        policy_id,
    ))
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
    env.storage().instance().get(&DataKey::PolicyExpiredEventEndLedger(
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
