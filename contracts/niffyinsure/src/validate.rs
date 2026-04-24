use soroban_sdk::{contracterror, BytesN, Env, String, Vec};

use crate::types::{
    Claim, ClaimEvidenceEntry, MultiplierTable, Policy, RiskInput, DETAILS_MAX_LEN, IMAGE_URLS_MAX,
    IMAGE_URL_MAX_LEN, REASON_MAX_LEN, SAFETY_SCORE_MAX,
};
#[cfg(feature = "experimental")]
use crate::types::{OracleSource, OracleTrigger, TriggerEventType, TriggerStatus};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    ZeroCoverage = 1,
    ZeroPremium = 2,
    InvalidLedgerWindow = 3,
    PolicyExpired = 4,
    PolicyInactive = 5,
    ClaimAmountZero = 6,
    ClaimExceedsCoverage = 7,
    DetailsTooLong = 8,
    TooManyImageUrls = 9,
    ImageUrlTooLong = 10,
    ReasonTooLong = 11,
    ClaimAlreadyTerminal = 12,
    DuplicateVote = 13,
    InvalidBaseAmount = 14,
    SafetyScoreOutOfRange = 15,
    InvalidConfigVersion = 16,
    MissingRegionMultiplier = 17,
    MissingAgeMultiplier = 18,
    MissingCoverageMultiplier = 19,
    RegionMultiplierOutOfBounds = 20,
    AgeMultiplierOutOfBounds = 21,
    CoverageMultiplierOutOfBounds = 22,
    SafetyDiscountOutOfBounds = 23,
    Overflow = 24,
    DivideByZero = 25,
    InvalidQuoteTtl = 26,
    NegativePremiumNotSupported = 27,
    ClaimNotFound = 28,
    InvalidAsset = 29,
    InsufficientTreasury = 30,
    AlreadyPaid = 31,
    ClaimNotApproved = 32,
    DuplicateOpenClaim = 33,
    ExcessiveEvidenceBytes = 34,
    PolicyNotFound = 35,
    CalculatorNotSet = 36,
    CalculatorCallFailed = 37,
    CalculatorPaused = 38,
    VotingWindowClosed = 39,
    VotingWindowStillOpen = 40,
    NotEligibleVoter = 41,
    RateLimitExceeded = 42,
    /// Admin `set_voting_duration_ledgers` value outside allowed [min, max] range.
    VotingDurationOutOfBounds = 49,
    /// Batch get exceeded POLICY_BATCH_GET_MAX.
    PolicyBatchTooLarge = 50,
    /// Claim voter snapshot persistent entry is missing or expired (Soroban TTL).
    /// Keepers should call `refresh_snapshot` before eviction during open votes.
    VoterSnapshotExpired = 51,
    /// Supplied `expected_nonce` does not match the holder's current on-chain nonce.
    /// Read the current value via `get_nonce(holder)` before retrying.
    NonceMismatch = 52,
    /// Keeper `process_deadline` called on a claim not in `Processing` status.
    ClaimNotProcessing = 53,
}

pub fn validate_quorum_bps(bps: u32) -> Result<(), Error> {
    use crate::types::{QUORUM_BPS_MAX, QUORUM_BPS_MIN};
    if !(QUORUM_BPS_MIN..=QUORUM_BPS_MAX).contains(&bps) {
        // Reuse bounded-config error code (Soroban `contracterror` caps variant count).
        return Err(Error::VotingDurationOutOfBounds);
    }
    Ok(())
}

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
    if let Some(d) = policy.deductible {
        if d < 0 || d > policy.coverage {
            // No free `contracterror` slots: treat misconfigured deductible as overflow-style limits.
            return Err(Error::Overflow);
        }
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

fn sha256_commitment_non_zero(h: &BytesN<32>) -> bool {
    for i in 0u32..32u32 {
        if h.get(i).unwrap_or(0) != 0 {
            return true;
        }
    }
    false
}

pub fn check_claim_fields(
    env: &Env,
    amount: i128,
    coverage: i128,
    details: &String,
    evidence: &Vec<ClaimEvidenceEntry>,
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
    let max_evidence = crate::storage::get_max_evidence_count(env);
    if evidence.len() > max_evidence {
        return Err(Error::TooManyImageUrls);
    }
    for entry in evidence.iter() {
        if entry.url.len() > IMAGE_URL_MAX_LEN {
            return Err(Error::ImageUrlTooLong);
        }
        if !sha256_commitment_non_zero(&entry.hash) {
            // `ExcessiveEvidenceBytes` is the reserved evidence bucket (no dedicated enum slot left).
            return Err(Error::ExcessiveEvidenceBytes);
        }
    }
    let _ = env;
    Ok(())
}

pub fn check_reason(reason: &String) -> Result<(), Error> {
    if reason.len() > REASON_MAX_LEN {
        return Err(Error::ReasonTooLong);
    }
    Ok(())
}

pub fn check_claim_open(claim: &Claim) -> Result<(), Error> {
    if claim.status != crate::types::ClaimStatus::Processing {
        return Err(Error::ClaimAlreadyTerminal);
    }
    Ok(())
}

// ═════════════════════════════════════════════════════════════════════════════
// ORACLE / PARAMETRIC TRIGGER VALIDATION
//
// ⚠️  LEGAL / COMPLIANCE REVIEW GATE: These validators are non-functional
// stubs for future oracle-triggered parametric insurance.  Do NOT activate
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

#[cfg(feature = "experimental")]
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
    /// Ed25519 signature verification failed.
    InvalidSignature,
    /// Oracle source has no registered public key.
    SourceNotRegistered,
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
    /// Nonce is not strictly greater than the last accepted nonce (replay attack).
    ReplayedNonce,
    /// Quorum threshold not met (not enough valid signatures).
    QuorumNotMet,
}

// ── Oracle trigger validators (experimental only) ────────────────────────────

/// Validates an oracle trigger including Ed25519 signature verification and nonce replay protection.
///
/// Signed message layout (big-endian concatenation):
///   policy_id (4 bytes) || timestamp (8 bytes) || nonce (8 bytes) || payload (variable)
///
/// The oracle source must have a registered Ed25519 public key via `set_oracle_pub_key`.
/// The nonce must be strictly greater than the last accepted nonce for this source.
#[cfg(feature = "experimental")]
pub fn check_oracle_trigger(
    env: &Env,
    trigger: &OracleTrigger,
    current_ledger: u32,
    max_trigger_age_ledgers: u32,
) -> Result<(), OracleError> {
    use crate::storage;
    use soroban_sdk::{Address, Bytes};

    // 1. Oracle globally enabled
    if !storage::is_oracle_enabled(env) {
        return Err(OracleError::OracleDisabled);
    }

    // 2. Ledger freshness
    if current_ledger > trigger.trigger_ledger.saturating_add(max_trigger_age_ledgers) {
        return Err(OracleError::TriggerLedgerExpired);
    }

    // 3. Source must be defined
    if matches!(trigger.source, OracleSource::Undefined) {
        return Err(OracleError::SourceNotWhitelisted);
    }

    // 4. Event type must be defined
    if matches!(trigger.event_type, TriggerEventType::Undefined) {
        return Err(OracleError::InvalidPayloadEncoding);
    }

    // 5. Payload non-empty for defined event types
    if trigger.payload.is_empty() {
        return Err(OracleError::EmptyPayload);
    }

    // 6. Resolve source address from OracleSource variant
    let source_addr: Address = match &trigger.source {
        OracleSource::Registered(addr) => addr.clone(),
        OracleSource::Undefined => return Err(OracleError::SourceNotWhitelisted),
    };

    // 7. Look up registered public key
    let pub_key = storage::get_oracle_pub_key(env, &source_addr)
        .ok_or(OracleError::SourceNotRegistered)?;

    // 8. Build signed message: policy_id(4) || timestamp(8) || nonce(8) || payload
    let mut msg = Bytes::new(env);
    msg.extend_from_array(&trigger.policy_id.to_be_bytes());
    msg.extend_from_array(&trigger.timestamp.to_be_bytes());
    msg.extend_from_array(&trigger.nonce.to_be_bytes());
    msg.append(&trigger.payload);

    // 9. Ed25519 signature verification — panics on invalid sig (Soroban convention)
    env.crypto().ed25519_verify(&pub_key, &msg, &trigger.signature);

    // 10. Nonce replay protection (strictly increasing)
    storage::advance_oracle_nonce(env, &source_addr, trigger.nonce)?;

    // 11. Quorum check — for single-sig sources quorum is 1 (already satisfied above)
    let quorum = storage::get_oracle_quorum(env, &source_addr);
    if quorum > 1 {
        // Multi-oracle quorum: quorum > 1 requires aggregated signatures.
        // Current implementation supports single-sig; reject if quorum > 1 is configured
        // until multi-sig aggregation is implemented.
        return Err(OracleError::QuorumNotMet);
    }

    Ok(())
}

/// Validates trigger status transitions.
///
/// Ensures triggers can only move through valid state transitions.
#[cfg(feature = "experimental")]
pub fn check_trigger_status_transition(
    current: TriggerStatus,
    next: TriggerStatus,
) -> Result<(), OracleError> {
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

// ═════════════════════════════════════════════════════════════════════════════
// STUB VALIDATORS FOR DEFAULT (NON-EXPERIMENTAL) BUILDS
//
// These functions ensure that default builds CANNOT validate oracle triggers.
// If called in a non-experimental build, they will panic at runtime.
// This is intentional for production safety.
// ═════════════════════════════════════════════════════════════════════════════

#[cfg(not(feature = "experimental"))]
#[derive(Debug, PartialEq)]
pub enum OracleError {
    OracleDisabled,
    ReplayedNonce,
    QuorumNotMet,
    InvalidSignature,
    SourceNotRegistered,
}

/// Stub: Panics in default builds to prevent oracle trigger validation.
///
/// ⚠️  DO NOT REMOVE THIS FUNCTION.  It ensures production safety by
/// creating a compile-time and runtime guarantee that oracle triggers
/// cannot be validated without the experimental feature flag.
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

/// Stub: Panics in default builds.
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

pub fn check_risk_input(input: &RiskInput) -> Result<(), Error> {
    if input.safety_score > SAFETY_SCORE_MAX {
        return Err(Error::SafetyScoreOutOfRange);
    }
    Ok(())
}

pub fn check_multiplier_table_shape(table: &MultiplierTable) -> Result<(), Error> {
    if table.region.len() != 3u32 {
        return Err(Error::MissingRegionMultiplier);
    }
    if table.age.len() != 3u32 {
        return Err(Error::MissingAgeMultiplier);
    }
    if table.coverage.len() != 3u32 {
        return Err(Error::MissingCoverageMultiplier);
    }
    Ok(())
}
