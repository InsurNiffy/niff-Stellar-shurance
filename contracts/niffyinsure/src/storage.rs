use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::types::{Claim, MultiplierTable, Policy, VoteOption};

// ── TTL constants ─────────────────────────────────────────────────────────────
/// Minimum TTL threshold before we extend (in ledgers).
pub const PERSISTENT_TTL_THRESHOLD: u32 = 100_000;
/// Target TTL after extension (in ledgers, ~1 year).
pub const PERSISTENT_TTL_EXTEND_TO: u32 = 6_000_000;

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
}

// ── Instance bump ─────────────────────────────────────────────────────────────

pub fn has_open_claim(env: &Env, holder: &Address, policy_id: u32) -> bool {
    env.storage().instance().get(&DataKey::OpenClaim(holder.clone(), policy_id)).unwrap_or(false)
}

pub fn set_open_claim(env: &Env, holder: &Address, policy_id: u32, open: bool) {
    env.storage().instance().set(&DataKey::OpenClaim(holder.clone(), policy_id), &open);
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
    env.storage().instance().set(&DataKey::PendingAdmin, pending);
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
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PauseFlags {
    pub bind_paused: bool,
    pub claims_paused: bool,
}

impl Default for PauseFlags {
    fn default() -> Self {
        Self {
            bind_paused: false,
            claims_paused: false,
        }
    }
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

/// Returns the number of active policies for `holder` (vote weight).
pub fn get_active_policy_count(env: &Env, holder: &Address) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::ActivePolicyCount(holder.clone()))
        .unwrap_or(0)
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
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

pub fn set_claim_voters(env: &Env, claim_id: u64, voters: &Vec<Address>) {
    let key = DataKey::ClaimVoters(claim_id);
    env.storage().persistent().set(&key, voters);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
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
