use soroban_sdk::{Env, String, Vec};

use crate::types::{
    Claim, Policy, DETAILS_MAX_LEN, IMAGE_URLS_MAX, IMAGE_URL_MAX_LEN, REASON_MAX_LEN,
};

#[derive(Debug, PartialEq)]
pub enum Error {
    ZeroCoverage,
    ZeroPremium,
    InvalidLedgerWindow, // end_ledger <= start_ledger
    PolicyExpired,       // current_ledger >= end_ledger
    PolicyInactive,
    ClaimAmountZero,
    ClaimExceedsCoverage,
    DetailsTooLong,
    TooManyImageUrls,
    ImageUrlTooLong,
    ReasonTooLong,
    ClaimAlreadyTerminal,
    DuplicateVote,
}

// ── Policy validators ─────────────────────────────────────────────────────────

pub fn check_policy(policy: &Policy) -> Result<(), Error> {
    if policy.coverage <= 0 {
        return Err(Error::ZeroCoverage);
    }
    if policy.premium <= 0 {
        return Err(Error::ZeroPremium);
    }
    if policy.end_ledger <= policy.start_ledger {
        return Err(Error::InvalidLedgerWindow);
    }
    Ok(())
}

pub fn check_policy_active(policy: &Policy, current_ledger: u32) -> Result<(), Error> {
    if !policy.is_active {
        return Err(Error::PolicyInactive);
    }
    if current_ledger >= policy.end_ledger {
        return Err(Error::PolicyExpired);
    }
    Ok(())
}

// ── Claim validators ──────────────────────────────────────────────────────────

pub fn check_claim_fields(
    env: &Env,
    amount: i128,
    coverage: i128,
    details: &String,
    image_urls: &Vec<String>,
) -> Result<(), Error> {
    if amount <= 0 {
        return Err(Error::ClaimAmountZero);
    }
    if amount > coverage {
        return Err(Error::ClaimExceedsCoverage);
    }
    if details.len() > DETAILS_MAX_LEN {
        return Err(Error::DetailsTooLong);
    }
    if image_urls.len() > IMAGE_URLS_MAX {
        return Err(Error::TooManyImageUrls);
    }
    for url in image_urls.iter() {
        if url.len() > IMAGE_URL_MAX_LEN {
            return Err(Error::ImageUrlTooLong);
        }
    }
    let _ = env; // env available for future auth checks
    Ok(())
}

pub fn check_reason(reason: &String) -> Result<(), Error> {
    if reason.len() > REASON_MAX_LEN {
        return Err(Error::ReasonTooLong);
    }
    Ok(())
}

// ── Vote / status validators ──────────────────────────────────────────────────

pub fn check_claim_open(claim: &Claim) -> Result<(), Error> {
    if claim.status.is_terminal() {
        return Err(Error::ClaimAlreadyTerminal);
    }
    Ok(())
}

// ═════════════════════════════════════════════════════════════════════════════
// ORACLE / PARAMETRIC TRIGGER VALIDATION
//
// ⚠️  LEGAL / COMPLIANCE REVIEW GATE: These validators are gated behind the
// `experimental` feature.  Default builds expose panic stubs.  Do NOT activate
// in production without:
//   • Completed regulatory classification review (parametric vs indemnity)
//   • Legal review of smart contract-triggered payouts
//   • Game-theoretic analysis of oracle incentivization
//   • Cryptographic design review for signature verification
//
// CRYPTOGRAPHIC DESIGN NOTE:
//   All signature verification MUST be reviewed before implementation.
//   Known concerns to resolve:
//     - Replay attack prevention (nonce management)
//     - Oracle key rotation mechanism
//     - Sybil resistance (preventing fake oracles)
//     - Collusion detection
// ═════════════════════════════════════════════════════════════════════════════

/// Oracle-specific error codes.
///
/// Defined unconditionally so that panic stubs in default builds and
/// test code can reference the type without the `experimental` feature.
#[derive(Debug, PartialEq)]
pub enum OracleError {
    /// Oracle triggers globally disabled.
    OracleDisabled,
    /// Trigger timestamp is too old (TTL exceeded).
    TriggerExpired,
    /// Trigger timestamp is in the future.
    TriggerFutureTimestamp,
    /// Trigger ledger sequence is too old.
    TriggerLedgerExpired,
    /// Signature verification failed.
    InvalidSignature,
    /// Non-empty signature in pre-crypto-review build.
    SignatureNotImplemented,
    /// Policy does not exist for this trigger.
    PolicyNotFound,
    /// Policy is not active.
    PolicyInactive,
    /// Policy does not cover this trigger event type.
    EventTypeNotCovered,
    /// Oracle source not in whitelist.
    SourceNotWhitelisted,
    /// Trigger already processed.
    TriggerAlreadyProcessed,
    /// Empty payload when non-empty required.
    EmptyPayload,
    /// Payload exceeds maximum size.
    PayloadTooLarge,
    /// Invalid payload encoding for event type.
    InvalidPayloadEncoding,
}

// ── Oracle trigger validators (experimental only) ────────────────────────────

/// Validates that an oracle trigger is safe to process.
///
/// Performs non-cryptographic validation only.
///
/// ⚠️  CRYPTOGRAPHIC VALIDATION (signature verification) IS NOT IMPLEMENTED.
/// Signature verification must be designed and audited before triggers can
/// be accepted from oracles.
#[cfg(feature = "experimental")]
pub fn check_oracle_trigger(
    env: &Env,
    trigger: &crate::types::OracleTrigger,
    current_ledger: u32,
    max_trigger_age_ledgers: u32,
) -> Result<(), OracleError> {
    use crate::storage;
    use crate::types::{OracleSource, TriggerEventType};

    // 1. Check that oracle triggers are globally enabled
    if !storage::is_oracle_enabled(env) {
        return Err(OracleError::OracleDisabled);
    }

    // 2. Check trigger ledger hasn't expired
    if current_ledger > trigger.trigger_ledger + max_trigger_age_ledgers {
        return Err(OracleError::TriggerLedgerExpired);
    }

    // 3. Reject non-empty signatures until crypto review is complete
    //
    // ⚠️  SECURITY CRITICAL: This check ensures we cannot accidentally
    // accept signed data before crypto review is complete.
    if !trigger.signature.is_empty() {
        return Err(OracleError::SignatureNotImplemented);
    }

    // 4. Check payload is non-empty for defined event types
    if trigger.payload.is_empty() && !matches!(trigger.event_type, TriggerEventType::Undefined) {
        return Err(OracleError::EmptyPayload);
    }

    // 5. Check event type is defined
    if matches!(trigger.event_type, TriggerEventType::Undefined) {
        return Err(OracleError::InvalidPayloadEncoding);
    }

    // 6. Check source is defined
    if matches!(trigger.source, OracleSource::Undefined) {
        return Err(OracleError::SourceNotWhitelisted);
    }

    // TODO (post-crypto-review): nonce/replay protection, multi-oracle quorum

    Ok(())
}

/// Validates trigger status transitions.
#[cfg(feature = "experimental")]
pub fn check_trigger_status_transition(
    current: crate::types::TriggerStatus,
    next: crate::types::TriggerStatus,
) -> Result<(), OracleError> {
    use crate::types::TriggerStatus;

    match (&current, &next) {
        // Valid transitions
        (TriggerStatus::Pending, TriggerStatus::Validated) => Ok(()),
        (TriggerStatus::Pending, TriggerStatus::Rejected) => Ok(()),
        (TriggerStatus::Pending, TriggerStatus::Expired) => Ok(()),
        (TriggerStatus::Validated, TriggerStatus::Executed) => Ok(()),
        (TriggerStatus::Validated, TriggerStatus::Rejected) => Ok(()),
        // Invalid transitions
        (TriggerStatus::Executed, _) => Err(OracleError::TriggerAlreadyProcessed),
        (TriggerStatus::Rejected, _) => Err(OracleError::TriggerAlreadyProcessed),
        (TriggerStatus::Expired, _) => Err(OracleError::TriggerAlreadyProcessed),
        // Same state is allowed (idempotent)
        _ if current == next => Ok(()),
        // Catch-all for undefined transitions
        _ => Err(OracleError::TriggerAlreadyProcessed),
    }
}

// ── Panic stubs for default (non-experimental) builds ─────────────────────

/// Stub: panics in default builds to prevent oracle trigger validation.
#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn check_oracle_trigger(
    _env: &Env,
    _trigger: &crate::types::OracleTrigger,
    _current_ledger: u32,
    _max_trigger_age_ledgers: u32,
) -> Result<(), OracleError> {
    panic!(
        "ORACLE_VALIDATION_DISABLED: Oracle trigger validation is not enabled in this build. \
         Default production builds cannot validate oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

/// Stub: panics in default builds.
#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn check_trigger_status_transition(
    _current: crate::types::TriggerStatus,
    _next: crate::types::TriggerStatus,
) -> Result<(), OracleError> {
    panic!(
        "ORACLE_VALIDATION_DISABLED: Oracle trigger status transitions are not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}
