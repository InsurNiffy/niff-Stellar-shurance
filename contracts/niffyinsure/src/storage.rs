use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::types::{Claim, Policy, VoteOption};
use soroban_sdk::{contracttype, Address, Env, Vec};

// ── TTL constants ─────────────────────────────────────────────────────────────
//
// Soroban persistent entries are evicted when their TTL reaches 0.
// We extend on every write so active data is never silently lost.
//
// ~1 year at ~5 s/ledger ≈ 6_307_200 ledgers.  We use a round number.
/// Minimum TTL threshold before we extend (in ledgers).
pub const PERSISTENT_TTL_THRESHOLD: u32 = 100_000;
/// Target TTL after extension (in ledgers, ~1 year).
pub const PERSISTENT_TTL_EXTEND_TO: u32 = 6_000_000;

// ── DataKey ───────────────────────────────────────────────────────────────────

/// Exhaustive enumeration of every storage key used by the contract.
///
/// Variants are grouped by storage tier in the keyspace diagram above.
/// No other module may construct these variants directly.
#[contracttype]
pub enum DataKey {
    // ── Instance tier ────────────────────────────────────────────────────
    /// Contract administrator address.
    Admin,
    /// SEP-41 token contract used for premium payments and claim payouts.
    Token,
    PremiumTable,
    AllowedAsset(Address),
    /// (holder, policy_id) — policy_id is per-holder u32
    Policy(Address, u32),
    /// Per-holder policy counter; next policy_id = counter + 1
    PolicyCounter(Address),
    /// Full policy record keyed by (holder, per-holder policy_id).
    Policy(Address, u32),
    /// Full claim record keyed by global claim_id.
    Claim(u64),
    /// (claim_id, voter_address) → VoteOption; immutable after first write
    Vote(u64, Address),
    /// Vec<Address> of all current active policyholders (voters)
    Voters,
    /// Global monotonic claim id counter
    ClaimCounter,
    /// Contract pause flag (bool). Missing ≡ not paused.
    Paused,
    /// Per-holder active policy count; used for weighted voting.
    ActivePolicyCount(Address),
}

// ── Instance bump ─────────────────────────────────────────────────────────────

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

#[allow(dead_code)]
pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("contract not initialised: admin missing")
}

// ── Token ─────────────────────────────────────────────────────────────────────

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

#[allow(dead_code)]
pub fn get_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .expect("contract not initialised: token missing")
}

pub fn set_multiplier_table(env: &Env, table: &MultiplierTable) {
    env.storage().instance().set(&DataKey::PremiumTable, table);
}

pub fn get_multiplier_table(env: &Env) -> MultiplierTable {
    env.storage().instance().get(&DataKey::PremiumTable).unwrap()
}

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

pub fn set_claim(env: &Env, claim: &crate::types::Claim) {
    env.storage()
        .persistent()
        .set(&DataKey::Claim(claim.claim_id), claim);
}

pub fn get_claim(env: &Env, claim_id: u64) -> Option<crate::types::Claim> {
    env.storage().persistent().get(&DataKey::Claim(claim_id))
}

#[allow(dead_code)]
pub fn next_policy_id(env: &Env, holder: &Address) -> u32 {
    let key = DataKey::PolicyCounter(holder.clone());
    let current: u32 = env.storage().persistent().get(&key).unwrap_or(0);
    let next = current
        .checked_add(1)
        .unwrap_or_else(|| panic!("policy_id overflow"));
    env.storage().persistent().set(&key, &next);
    next
}

#[allow(dead_code)]
pub fn next_claim_id(env: &Env) -> u64 {
    let current: u64 = env
        .storage()
        .instance()
        .get(&DataKey::ClaimCounter)
        .unwrap_or(0u64);
    let next = current
        .checked_add(1)
        .unwrap_or_else(|| panic!("claim_id overflow"));
    env.storage().instance().set(&DataKey::ClaimCounter, &next);
    next
}

// ── Voters (instance) ─────────────────────────────────────────────────────────

/// Returns the current voter list; empty Vec if none registered yet.
pub fn get_voters(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Voters)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_voters(env: &Env, voters: &Vec<Address>) {
    env.storage().instance().set(&DataKey::Voters, voters);
}

/// Adds `holder` to the voter list if not already present.
pub fn add_voter(env: &Env, holder: &Address) {
    let mut voters = get_voters(env);
    for v in voters.iter() {
        if v == *holder {
            return;
        }
    }
    voters.push_back(holder.clone());
    set_voters(env, &voters);
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

// ── Policy counter (persistent) ───────────────────────────────────────────────

/// Returns the last assigned policy_id for `holder` (0 = none yet).
pub fn get_policy_counter(env: &Env, holder: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::PolicyCounter(holder.clone()))
        .unwrap_or(0u32)
}

/// Increments the per-holder policy counter and returns the new policy_id.
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

// ── Pause flag ───────────────────────────────────────────────────────────────

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::Paused, &paused);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

// ── Policy persistence ───────────────────────────────────────────────────────

pub fn set_policy(env: &Env, holder: &Address, policy_id: u32, policy: &crate::types::Policy) {
    env.storage()
        .persistent()
        .set(&DataKey::Policy(holder.clone(), policy_id), policy);
}

pub fn get_policy(env: &Env, holder: &Address, policy_id: u32) -> Option<crate::types::Policy> {
    env.storage()
        .persistent()
        .get(&DataKey::Policy(holder.clone(), policy_id))
}

// ── Voter registry ───────────────────────────────────────────────────────────
//
// Vote-weight semantics: **one-policy-one-vote**.
// Each active policy grants exactly one vote.  A holder with N active policies
// has N votes in claim governance.  `ActivePolicyCount(holder)` tracks this.
// `Voters` is a deduplicated Vec<Address> of holders with ≥1 active policy;
// it is used for quorum denominator calculation.  `vote_on_claim` multiplies
// each ballot by the holder's `ActivePolicyCount` at vote time.

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
    // Check membership — linear scan is acceptable for DAO-scale voter sets.
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

    // Increment active policy count.
    let key = DataKey::ActivePolicyCount(holder.clone());
    let count: u32 = env.storage().instance().get(&key).unwrap_or(0);
    env.storage().instance().set(&key, &(count + 1));
}

/// Returns the number of active policies for `holder` (vote weight).
pub fn get_active_policy_count(env: &Env, holder: &Address) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::ActivePolicyCount(holder.clone()))
        .unwrap_or(0)
}
