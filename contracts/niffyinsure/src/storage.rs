use soroban_sdk::{contracttype, Address, Env};

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    /// (holder, policy_id) — policy_id is per-holder u32
    Policy(Address, u32),
    /// Per-holder policy counter; next policy_id = counter + 1
    PolicyCounter(Address),
    Claim(u64),
    /// (claim_id, voter_address) → VoteOption
    Vote(u64, Address),
    /// (claim_id, voter_address, appeal_count) → VoteOption for phase-specific voting
    VotePhase(u64, Address, u32),
    /// Vec<Address> of all current active policyholders (voters)
    Voters,
    /// Global monotonic claim id counter
    ClaimCounter,
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

/// Used by initialize and admin drain (feat/admin).
#[allow(dead_code)]
pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

/// Used by claim payout (feat/claim-voting).
#[allow(dead_code)]
pub fn get_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).unwrap()
}

/// Returns the next policy_id for `holder` and increments the counter.
/// Used by feat/policy-lifecycle.
#[allow(dead_code)]
pub fn next_policy_id(env: &Env, holder: &Address) -> u32 {
    let key = DataKey::PolicyCounter(holder.clone());
    let next: u32 = env.storage().persistent().get(&key).unwrap_or(0) + 1;
    env.storage().persistent().set(&key, &next);
    next
}

/// Returns the next global claim_id and increments the counter.
/// Used by feat/claim-voting.
#[allow(dead_code)]
pub fn next_claim_id(env: &Env) -> u64 {
    let next: u64 = env
        .storage()
        .instance()
        .get(&DataKey::ClaimCounter)
        .unwrap_or(0u64)
        + 1;
    env.storage().instance().set(&DataKey::ClaimCounter, &next);
    next
}

pub fn get_claim_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::ClaimCounter)
        .unwrap_or(0u64)
}

pub fn get_policy_counter(env: &Env, holder: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::PolicyCounter(holder.clone()))
        .unwrap_or(0u32)
}

pub fn has_policy(env: &Env, holder: &Address, policy_id: u32) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Policy(holder.clone(), policy_id))
}


// ═════════════════════════════════════════════════════════════════════════════
// ORACLE / PARAMETRIC TRIGGER STORAGE HELPERS (experimental only)
//
// ⚠️  LEGAL / COMPLIANCE REVIEW GATE: These functions are non-operational
// stubs.  They panic in default builds and must NOT be called until:
//   • Regulatory classification is complete
//   • Legal review approves automatic trigger-to-claim flow
//   • Game-theoretic safeguards are implemented
//   • Cryptographic signature verification is designed and audited
//
// PRODUCTION SAFETY: Default builds (without `experimental` feature)
// will panic if any of these functions are called, ensuring oracle
// triggers cannot be processed accidentally.
// ═════════════════════════════════════════════════════════════════════════════

#[cfg(feature = "experimental")]
use crate::types::{OracleTrigger, TriggerStatus};

/// Returns whether oracle triggers are globally enabled.
///
/// ⚠️  DEFAULT IS FALSE: Oracle triggers must be explicitly enabled by admin
/// after completing all required reviews (see DESIGN-ORACLE.md).
#[cfg(feature = "experimental")]
pub fn is_oracle_enabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::OracleEnabled)
        .unwrap_or(false)
}

/// Enable or disable oracle triggers globally.
///
/// ⚠️  ADMIN ACTION REQUIRED: This should remain false until:
///   • Cryptographic design review is complete
///   • Legal/compliance has approved parametric triggers
///   • Game-theoretic safeguards are implemented
#[cfg(feature = "experimental")]
pub fn set_oracle_enabled(env: &Env, enabled: bool) {
    env.storage().instance().set(&DataKey::OracleEnabled, &enabled);
}

/// Returns the next trigger_id and increments the counter.
///
/// ⚠️  PRODUCTION NOTE: Trigger ID generation must include replay protection.
/// Current implementation is a placeholder.
#[cfg(feature = "experimental")]
pub fn next_trigger_id(env: &Env) -> u64 {
    let key = DataKey::TriggerCounter;
    let next: u64 = env
        .storage()
        .instance()
        .get(&key)
        .unwrap_or(0u64)
        + 1;
    env.storage().instance().set(&key, &next);
    next
}

/// Store an oracle trigger.
///
/// ⚠️  SECURITY: Signature verification must be performed BEFORE calling
/// this function.  See validate_oracle_trigger() in validate.rs.
#[cfg(feature = "experimental")]
pub fn set_oracle_trigger(env: &Env, trigger_id: u64, trigger: &OracleTrigger) {
    env.storage()
        .persistent()
        .set(&DataKey::OracleTrigger(trigger_id), trigger);
}

/// Retrieve an oracle trigger by ID.
#[cfg(feature = "experimental")]
pub fn get_oracle_trigger(env: &Env, trigger_id: u64) -> Option<OracleTrigger> {
    env.storage()
        .persistent()
        .get(&DataKey::OracleTrigger(trigger_id))
}

/// Update trigger status.
#[cfg(feature = "experimental")]
pub fn set_trigger_status(env: &Env, trigger_id: u64, status: TriggerStatus) {
    env.storage()
        .persistent()
        .set(&DataKey::TriggerStatus(trigger_id), &status);
}

/// Get trigger status.
#[cfg(feature = "experimental")]
pub fn get_trigger_status(env: &Env, trigger_id: u64) -> Option<TriggerStatus> {
    env.storage()
        .persistent()
        .get(&DataKey::TriggerStatus(trigger_id))
}

// ═════════════════════════════════════════════════════════════════════════════
// STUB IMPLEMENTATIONS FOR DEFAULT (NON-EXPERIMENTAL) BUILDS
//
// These functions ensure that default builds CANNOT process oracle triggers.
// If called in a non-experimental build, they will panic at runtime.
// This is intentional: it creates a hard failure mode that prevents accidental
// oracle trigger processing in production.
// ═════════════════════════════════════════════════════════════════════════════

#[cfg(not(feature = "experimental"))]
use crate::types::{OracleTrigger, TriggerStatus};

/// Stub: Panics in default builds to prevent oracle trigger processing.
///
/// ⚠️  DO NOT REMOVE THIS FUNCTION.  It ensures production safety by
/// creating a compile-time guarantee that oracle triggers cannot be
/// processed without the experimental feature flag.
#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn is_oracle_enabled(_env: &Env) -> bool {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger processing is not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

/// Stub: Panics in default builds.
#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn set_oracle_enabled(_env: &Env, _enabled: bool) {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger processing is not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

/// Stub: Panics in default builds.
#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn next_trigger_id(_env: &Env) -> u64 {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger ID generation is not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

/// Stub: Panics in default builds.
#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn set_oracle_trigger(_env: &Env, _trigger_id: u64, _trigger: &OracleTrigger) {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger storage is not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

/// Stub: Panics in default builds.
#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn get_oracle_trigger(_env: &Env, _trigger_id: u64) -> Option<OracleTrigger> {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger retrieval is not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

/// Stub: Panics in default builds.
#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn set_trigger_status(_env: &Env, _trigger_id: u64, _status: TriggerStatus) {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger status updates are not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

/// Stub: Panics in default builds.
#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn get_trigger_status(_env: &Env, _trigger_id: u64) -> Option<TriggerStatus> {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger status retrieval is not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
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
