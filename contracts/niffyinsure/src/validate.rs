use soroban_sdk::{contracterror, Bytes, BytesN, Env, Map, String, Vec};

use crate::types::{
    Claim, ClaimEvidenceEntry, MultiplierTable, Policy, RiskInput, DETAILS_MAX_LEN,
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
    /// Evidence URL does not match IPFS or allowlisted gateway format.
    InvalidEvidenceUrl = 43,
    /// Claim evidence update must happen before any votes are cast.
    ClaimEvidenceUpdateNotAllowed = 44,
    /// Evidence count must fit the configured min/max bounds.
    EvidenceCountOutOfBounds = 45,
    /// Treasury deposits must be strictly positive.
    ZeroTreasuryDeposit = 46,
    /// Caller is not on the authorized treasury depositor allowlist.
    UnauthorizedTreasuryDepositor = 47,
    /// Contract payout recipients must be allowlisted.
    PayoutRecipientContractNotAllowlisted = 48,
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
    /// New claim would exceed the rolling per-policy paid-amount cap for the current window.
    RollingClaimCapExceeded = 54,
    /// Keeper `process_payout_timeout` called before the approved payout deadline elapsed.
    PayoutDeadlineNotReached = 55,
    /// Claim amount is below the asset-specific minimum (issue #587).
    ClaimBelowMinAmount = 56,
    /// Claim amount exceeds the asset-specific maximum (issue #587).
    ClaimAboveMaxAmount = 57,
    /// Delegation not found or expired (issue #585).
    DelegationInvalid = 58,
    /// Operator lacks the required permission for this action (issue #585).
    DelegationPermissionDenied = 59,
    /// Primary treasury insufficient and no reinsurance configured (issue #581).
    NoReinsuranceConfigured = 60,
    /// Installment amount exceeds remaining unpaid balance on the claim.
    OverDisbursement = 61,
    /// Policy transfer target is invalid (zero address, same as current holder, or claim active).
    PolicyTransferInvalid = 62,
    /// Batch get exceeded CLAIM_BATCH_GET_MAX.
    ClaimBatchTooLarge = 63,
    /// Payout attempted while dispute window is still active.
    DisputeWindowActive = 64,
    /// Appeal window has closed; claimant can no longer open an appeal.
    AppealWindowClosed = 65,
    /// Claim has already used its one allowed appeal.
    AppealAlreadyUsed = 66,
    /// Voter has an active delegation and must vote through their delegate.
    VoteDelegated = 67,
    /// Circular vote delegation detected.
    CircularDelegation = 68,
    /// Claim amount is below the minimum evidence count requirement.
    InsufficientEvidence = 69,
    /// Per-policy cooldown window has not yet elapsed since the last resolved claim.
    CooldownActive = 70,
    /// Protocol fee basis points exceed the maximum allowed.
    ProtocolFeeOutOfBounds = 71,
    /// Minimum solvency ratio basis points outside documented bounds.
    SolvencyRatioOutOfBounds = 72,
    /// External premium calculator ABI version does not match the expected pin.
    CalculatorVersionMismatch = 73,
    /// Commit-reveal voting phases are not configured for this claim.
    CommitRevealNotSet = 74,
    /// Commit phase has ended; new vote commitments are rejected.
    CommitPhaseEnded = 75,
    /// Reveal phase has not started yet.
    RevealPhaseNotOpen = 76,
    /// Reveal phase has ended; late reveals are rejected.
    RevealPhaseEnded = 77,
    /// No commitment found for this voter on the claim.
    CommitmentNotFound = 78,
    /// Revealed vote does not match the prior commitment hash.
    CommitmentMismatch = 79,
    /// Evidence array contains a duplicate (url, hash) pair.
    DuplicateEvidence = 80,
    /// Claimant attempted to vote on their own pending claim.
    SelfVoteNotAllowed = 84,
    /// Requested page_size exceeds the hard cap for this query.
    PageSizeTooLarge = 81,
    /// Escalation deadline must be strictly after the current ledger.
    EscalationDeadlineNotFuture = 82,
    /// Escalation deadline must be earlier than the current voting deadline.
    EscalationDeadlineNotEarlier = 83,
    /// Coverage amount is below the configured minimum floor.
    CoverageBelowFloor = 85,
    /// Voter cap per claim has been reached.
    VoterCapReached = 86,
}

pub fn check_claim_evidence_update(
    env: &Env,
    evidence: &Vec<ClaimEvidenceEntry>,
) -> Result<(), Error> {
    let max_evidence = crate::storage::get_max_evidence_count(env);
    if evidence.len() > max_evidence {
        return Err(Error::EvidenceCountOutOfBounds);
    }
    let min_evidence = crate::storage::get_min_evidence_count(env);
    if evidence.len() < min_evidence {
        return Err(Error::InsufficientEvidence);
    }
    for entry in evidence.iter() {
        if entry.url.len() > IMAGE_URL_MAX_LEN {
            return Err(Error::ImageUrlTooLong);
        }
        validate_evidence_url(env, &entry.url)?;
    }
    Ok(())
}

pub fn validate_quorum_bps(bps: u32) -> Result<(), Error> {
    use crate::types::{QUORUM_BPS_MAX, QUORUM_BPS_MIN};
    if !(QUORUM_BPS_MIN..=QUORUM_BPS_MAX).contains(&bps) {
        // Reuse bounded-config error code (Soroban `contracterror` caps variant count).
        return Err(Error::VotingDurationOutOfBounds);
    }
    Ok(())
}

pub fn validate_protocol_fee_bps(bps: u32) -> Result<(), Error> {
    use crate::types::PROTOCOL_FEE_BPS_MAX;
    if bps > PROTOCOL_FEE_BPS_MAX {
        return Err(Error::ProtocolFeeOutOfBounds);
    }
    Ok(())
}

pub fn validate_min_solvency_ratio_bps(bps: u32) -> Result<(), Error> {
    use crate::types::{MIN_SOLVENCY_RATIO_BPS_MAX, MIN_SOLVENCY_RATIO_BPS_MIN};
    if !(MIN_SOLVENCY_RATIO_BPS_MIN..=MIN_SOLVENCY_RATIO_BPS_MAX).contains(&bps) {
        return Err(Error::SolvencyRatioOutOfBounds);
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
    let min_evidence = crate::storage::get_min_evidence_count(env);
    if evidence.len() < min_evidence {
        return Err(Error::InsufficientEvidence);
    }
    for entry in evidence.iter() {
        if entry.url.len() > IMAGE_URL_MAX_LEN {
            return Err(Error::ImageUrlTooLong);
        }
        if !sha256_commitment_non_zero(&entry.hash) {
            // `ExcessiveEvidenceBytes` is the reserved evidence bucket (no dedicated enum slot left).
            return Err(Error::ExcessiveEvidenceBytes);
        }
        // Validate evidence URL format
        validate_evidence_url(env, &entry.url)?;
    }
    // Reject duplicate (url, hash) pairs within the same submission in O(n) time.
    let mut seen: Map<(String, BytesN<32>), bool> = Map::new(env);
    for entry in evidence.iter() {
        let key = (entry.url.clone(), entry.hash.clone());
        if seen.contains_key(&key) {
            return Err(Error::DuplicateEvidence);
        }
        seen.set(&key, &true);
    }
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
    /// No trigger record found for the given trigger_id.
    ///
    /// This is the canonical "no data" response when querying a trigger that
    /// has not been submitted or has been pruned. Callers must treat this as a
    /// definitive "not found" — not as a transient network error.
    TriggerNotFound,
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
    if current_ledger
        > trigger
            .trigger_ledger
            .saturating_add(max_trigger_age_ledgers)
    {
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
    let pub_key =
        storage::get_oracle_pub_key(env, &source_addr).ok_or(OracleError::SourceNotRegistered)?;

    // 8. Build signed message: policy_id(4) || timestamp(8) || nonce(8) || payload
    let mut msg = Bytes::new(env);
    msg.extend_from_array(&trigger.policy_id.to_be_bytes());
    msg.extend_from_array(&trigger.timestamp.to_be_bytes());
    msg.extend_from_array(&trigger.nonce.to_be_bytes());
    msg.append(&trigger.payload);

    // 9. Ed25519 signature verification — panics on invalid sig (Soroban convention)
    env.crypto()
        .ed25519_verify(&pub_key, &msg, &trigger.signature);

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
    /// No trigger record found for the given trigger_id.
    ///
    /// Canonical "no data" response when the oracle stub has no data available
    /// for a requested query. Callers must treat this as a definitive
    /// "not found" — not as a transient error. This is the safe-failure mode
    /// when no oracle data has been submitted or the oracle is disabled.
    TriggerNotFound,
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

/// Validate evidence URL format: must be `ipfs://` or match an allowlisted gateway prefix.
pub fn validate_evidence_url(env: &Env, url: &String) -> Result<(), Error> {
    let url_bytes = url.to_bytes();

    if bytes_has_prefix(&url_bytes, b"ipfs://") {
        return Ok(());
    }

    let gateways = crate::storage::get_gateway_allowlist(env);
    for gateway in gateways.iter() {
        let gateway_bytes = gateway.to_bytes();
        if bytes_has_prefix_bytes(&url_bytes, &gateway_bytes) {
            return Ok(());
        }
    }

    Err(Error::InvalidEvidenceUrl)
}

fn bytes_has_prefix(haystack: &Bytes, prefix: &[u8]) -> bool {
    if haystack.len() < prefix.len() as u32 {
        return false;
    }
    for (i, byte) in prefix.iter().enumerate() {
        if haystack.get(i as u32).unwrap_or(0) != *byte {
            return false;
        }
    }
    true
}

fn bytes_has_prefix_bytes(haystack: &Bytes, prefix: &Bytes) -> bool {
    if haystack.len() < prefix.len() {
        return false;
    }
    for i in 0..prefix.len() {
        if haystack.get(i).unwrap_or(0) != prefix.get(i).unwrap_or(0) {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod evidence_url_validation_tests {
    use super::*;
    use soroban_sdk::{Env, String};

    #[test]
    fn ipfs_prefix_is_valid() {
        let env = Env::default();
        let contract_id = env.register(crate::NiffyInsure, ());
        let url = String::from_str(
            &env,
            "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        );
        env.as_contract(&contract_id, || {
            assert!(validate_evidence_url(&env, &url).is_ok());
        });
    }

    #[test]
    fn empty_string_is_invalid() {
        let env = Env::default();
        let contract_id = env.register(crate::NiffyInsure, ());
        let url = String::from_str(&env, "");
        env.as_contract(&contract_id, || {
            assert_eq!(
                validate_evidence_url(&env, &url).unwrap_err(),
                Error::InvalidEvidenceUrl
            );
        });
    }

    #[test]
    fn invalid_url_is_rejected() {
        let env = Env::default();
        let contract_id = env.register(crate::NiffyInsure, ());
        let url = String::from_str(&env, "https://example.com/file");
        env.as_contract(&contract_id, || {
            assert_eq!(
                validate_evidence_url(&env, &url).unwrap_err(),
                Error::InvalidEvidenceUrl
            );
        });
    }

    #[test]
    fn allowlisted_gateway_is_valid() {
        let env = Env::default();
        let contract_id = env.register(crate::NiffyInsure, ());
        env.as_contract(&contract_id, || {
            // Set up gateway allowlist
            let mut gateways = soroban_sdk::Vec::new(&env);
            gateways.push_back(String::from_str(&env, "https://gateway.pinata.cloud/ipfs/"));
            crate::storage::set_gateway_allowlist(&env, &gateways);

            let url = String::from_str(&env, "https://gateway.pinata.cloud/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi");
            assert!(validate_evidence_url(&env, &url).is_ok());
        });
    }

    #[test]
    fn non_allowlisted_gateway_is_invalid() {
        let env = Env::default();
        let contract_id = env.register(crate::NiffyInsure, ());
        env.as_contract(&contract_id, || {
            // Set up gateway allowlist with one gateway
            let mut gateways = soroban_sdk::Vec::new(&env);
            gateways.push_back(String::from_str(&env, "https://gateway.pinata.cloud/ipfs/"));
            crate::storage::set_gateway_allowlist(&env, &gateways);

            // Try a different gateway
            let url = String::from_str(&env, "https://other-gateway.com/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi");
            assert_eq!(
                validate_evidence_url(&env, &url).unwrap_err(),
                Error::InvalidEvidenceUrl
            );
        });
    }
}
