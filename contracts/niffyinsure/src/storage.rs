use soroban_sdk::{contracttype, Address, Env};

use crate::types::{OracleTrigger, TriggerStatus};

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
    // ── Oracle storage keys (always compiled for XDR schema consistency) ──
    OracleEnabled,
    TriggerCounter,
    OracleTrigger(u64),
    TriggerStatus(u64),
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
// ORACLE / PARAMETRIC TRIGGER STORAGE HELPERS
//
// ⚠️  LEGAL / COMPLIANCE REVIEW GATE: These functions are gated behind the
// `experimental` feature.  Default builds expose panic stubs to ensure oracle
// triggers cannot be processed accidentally.
//
// Required before activation (see DESIGN-ORACLE.md):
//   • Regulatory classification complete
//   • Legal review approves automatic trigger-to-claim flow
//   • Game-theoretic safeguards implemented
//   • Cryptographic signature verification designed and audited
// ═════════════════════════════════════════════════════════════════════════════

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
#[cfg(feature = "experimental")]
pub fn set_oracle_enabled(env: &Env, enabled: bool) {
    env.storage()
        .instance()
        .set(&DataKey::OracleEnabled, &enabled);
}

/// Returns the next trigger_id and increments the counter.
#[cfg(feature = "experimental")]
pub fn next_trigger_id(env: &Env) -> u64 {
    let key = DataKey::TriggerCounter;
    let next: u64 = env.storage().instance().get(&key).unwrap_or(0u64) + 1;
    env.storage().instance().set(&key, &next);
    next
}

/// Store an oracle trigger.
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

// ── Panic stubs for default (non-experimental) builds ─────────────────────
//
// These ensure that default builds CANNOT process oracle triggers.
// Called only in tests that verify the panic behaviour.

#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn is_oracle_enabled(_env: &Env) -> bool {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger processing is not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn set_oracle_enabled(_env: &Env, _enabled: bool) {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger processing is not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn next_trigger_id(_env: &Env) -> u64 {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger ID generation is not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn set_oracle_trigger(_env: &Env, _trigger_id: u64, _trigger: &OracleTrigger) {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger storage is not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn get_oracle_trigger(_env: &Env, _trigger_id: u64) -> Option<OracleTrigger> {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger retrieval is not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn set_trigger_status(_env: &Env, _trigger_id: u64, _status: TriggerStatus) {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger status updates are not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn get_trigger_status(_env: &Env, _trigger_id: u64) -> Option<TriggerStatus> {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger status retrieval is not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}
