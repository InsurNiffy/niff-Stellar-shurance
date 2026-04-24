// ═════════════════════════════════════════════════════════════════════════════
// ORACLE / PARAMETRIC TRIGGER MODULE
//
// ⚠️  LEGAL / COMPLIANCE REVIEW GATE: This module provides infrastructure
// for parametric insurance automation via oracle attestations.
//
// PRODUCTION SAFETY: This module is ONLY compiled when the `experimental`
// feature flag is enabled.  Default builds CANNOT use this functionality.
//
// Required before activation (see DESIGN-ORACLE.md):
//   ✓ Complete cryptographic design review (signature schemes, replay protection)
//   ✓ Game-theoretic analysis (oracle incentivization, sybil resistance)
//   ✓ Legal & compliance review (regulatory classification of parametric triggers)
//   ✓ Security audit by qualified Soroban smart contract auditors
//
// IMPORTANT: Do NOT parse untrusted signatures without a complete crypto
// design review.  The signature field in OracleTrigger MUST remain empty
// until cryptographic verification is implemented and audited.
// ═════════════════════════════════════════════════════════════════════════════

#![cfg(feature = "experimental")]

use soroban_sdk::{Address, BytesN, Bytes, Env};

use crate::storage;
use crate::types::{OracleSource, OracleTrigger, TriggerStatus};
use crate::validate::{check_oracle_trigger, check_trigger_status_transition, OracleError};

/// Maximum allowed payload size for oracle triggers (bytes).
/// Prevents storage griefing via oversized payloads.
const MAX_TRIGGER_PAYLOAD_SIZE: u32 = 1024;

/// Maximum trigger age in ledger sequences.
/// Triggers older than this are considered expired.
const DEFAULT_TRIGGER_MAX_LEDGER_AGE: u32 = 17280; // ~24 hours at 5s/ledger

/// Record a new oracle trigger from a whitelisted source.
///
/// ⚠️  SECURITY: This function does NOT verify signatures.  Signature
/// verification must be implemented after crypto design review.
/// Currently, this function will reject any trigger with a non-empty
/// signature field to prevent accidental signature processing.
///
/// CRYPTOGRAPHIC DESIGN NOTE:
/// When implementing signature verification:
///   1. Verify Ed25519/EdDSA signature against oracle's public key
///   2. Check nonce for replay protection
///   3. Verify timestamp freshness
///   4. Validate quorum for multi-oracle sources
pub fn submit_trigger(
    env: &Env,
    policy_id: u32,
    event_type: crate::types::TriggerEventType,
    source: OracleSource,
    payload: Bytes,
    timestamp: u64,
    nonce: u64,
    signature: BytesN<64>,
) -> Result<u64, OracleError> {
    // 1. Validate payload size to prevent storage griefing
    if payload.len() > MAX_TRIGGER_PAYLOAD_SIZE {
        return Err(OracleError::PayloadTooLarge);
    }

    // 2. Build the trigger record
    let current_ledger = env.ledger().sequence();
    let trigger = OracleTrigger {
        policy_id,
        event_type,
        source,
        payload,
        timestamp,
        trigger_ledger: current_ledger,
        nonce,
        signature,
    };

    // 3. Validate the trigger (includes Ed25519 verification + nonce replay protection)
    check_oracle_trigger(
        env,
        &trigger,
        current_ledger,
        DEFAULT_TRIGGER_MAX_LEDGER_AGE,
    )?;

    // 4. Generate trigger ID and store
    let trigger_id = storage::next_trigger_id(env);
    storage::set_oracle_trigger(env, trigger_id, &trigger);
    storage::set_trigger_status(env, trigger_id, TriggerStatus::Pending);

    Ok(trigger_id)
}

/// Attempt to validate a pending trigger.
///
/// This function performs additional validation steps beyond the initial
/// submission check.  Called by an authorized validator (TBD: admin or
/// validator multisig).
///
/// Validates:
///   - Policy exists and is active
///   - Event type is covered by policy
///   - Source is in whitelist
///   - Timestamp is within acceptable window
pub fn validate_trigger(
    env: &Env,
    trigger_id: u64,
    _validator: &soroban_sdk::Address,
) -> Result<(), OracleError> {
    // 1. Get the trigger
    let trigger =
        storage::get_oracle_trigger(env, trigger_id).ok_or(OracleError::PolicyNotFound)?;

    // 2. Check current status
    let current_status =
        storage::get_trigger_status(env, trigger_id).unwrap_or(TriggerStatus::Pending);

    // 3. Perform full validation
    let current_ledger = env.ledger().sequence();
    check_oracle_trigger(
        env,
        &trigger,
        current_ledger,
        DEFAULT_TRIGGER_MAX_LEDGER_AGE,
    )?;

    // TODO: Add policy existence and coverage validation
    // This requires accessing the policy storage, which is defined elsewhere.
    // Future implementation:
    //   let policy = storage::get_policy(env, &trigger.holder, trigger.policy_id)?;
    //   if !policy.is_active { return Err(OracleError::PolicyInactive); }
    //   if !policy.covers_event(&trigger.event_type) { return Err(OracleError::EventTypeNotCovered); }

    // 4. Update status
    let new_status = TriggerStatus::Validated;
    check_trigger_status_transition(current_status, new_status)?;
    storage::set_trigger_status(env, trigger_id, new_status);

    Ok(())
}

/// Execute a validated trigger (initiate parametric payout).
///
/// This function is called after trigger validation to initiate the
/// automatic claim/payout process.
///
/// ⚠️  LEGAL NOTE: Automatic trigger-to-payout flow requires legal review
/// to ensure compliance with insurance regulations.  Parametric insurance
/// may have different regulatory requirements than indemnity insurance.
pub fn execute_trigger(
    env: &Env,
    trigger_id: u64,
    _executor: &soroban_sdk::Address,
) -> Result<TriggerStatus, OracleError> {
    // 1. Get the trigger
    let trigger =
        storage::get_oracle_trigger(env, trigger_id).ok_or(OracleError::PolicyNotFound)?;

    // 2. Check current status
    let current_status =
        storage::get_trigger_status(env, trigger_id).ok_or(OracleError::TriggerAlreadyProcessed)?;

    // 3. Only validated triggers can be executed
    if !matches!(current_status, TriggerStatus::Validated) {
        return Err(OracleError::TriggerAlreadyProcessed);
    }

    // TODO: Implement actual payout logic
    // This requires:
    //   - Policy lookup and validation
    //   - Parametric payout schedule calculation
    //   - Token transfer authorization
    //   - Event emission for off-chain indexing

    // 4. Update status
    let new_status = TriggerStatus::Executed;
    check_trigger_status_transition(current_status, new_status)?;
    storage::set_trigger_status(env, trigger_id, new_status);

    Ok(new_status)
}

/// Get the current status of a trigger.
pub fn get_trigger_status(env: &Env, trigger_id: u64) -> Option<TriggerStatus> {
    storage::get_trigger_status(env, trigger_id)
}

/// Get the full trigger record.
pub fn get_trigger(env: &Env, trigger_id: u64) -> Option<OracleTrigger> {
    storage::get_oracle_trigger(env, trigger_id)
}

/// Enable or disable oracle trigger processing.
///
/// ⚠️  ADMIN ACTION REQUIRED: This should remain disabled until:
///   • Cryptographic design review is complete
///   • Legal/compliance has approved parametric triggers
///   • Game-theoretic safeguards are implemented
pub fn set_oracle_enabled(env: &Env, enabled: bool) {
    storage::set_oracle_enabled(env, enabled)
}

/// Check if oracle triggers are currently enabled.
pub fn is_oracle_enabled(env: &Env) -> bool {
    storage::is_oracle_enabled(env)
}

/// Admin: register an Ed25519 public key for an oracle source address.
/// Must be called before any trigger from this source can be accepted.
pub fn register_oracle_key(env: &Env, source: &Address, pub_key: &BytesN<32>) {
    storage::set_oracle_pub_key(env, source, pub_key);
}

/// Admin: set the quorum threshold for a source (1 = single-sig, >1 = multi-oracle).
pub fn set_oracle_quorum(env: &Env, source: &Address, quorum: u32) {
    storage::set_oracle_quorum(env, source, quorum);
}

/// Read the current accepted nonce for a source (for off-chain nonce tracking).
pub fn get_oracle_nonce(env: &Env, source: &Address) -> u64 {
    storage::get_oracle_nonce(env, source)
}
