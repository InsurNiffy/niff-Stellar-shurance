use crate::{
    events, ledger, premium, storage, token,
    types::{
        AgeBand, CoverageTier, CoverageType, Policy, PolicyType, PremiumQuote, RegionTier,
        RiskInput, STRIKE_DEACTIVATION_THRESHOLD,
    },
    validate::{self, Error},
};
pub use ledger::QUOTE_TTL_LEDGERS;
use soroban_sdk::{contracterror, contractevent, contracttype, Address, BytesN, Env, String};

/// Current event schema version.
pub const POLICY_EVENT_VERSION: u32 = 1;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PolicyError {
    /// Contract is paused by admin.
    ContractPaused = 100,
    /// A policy with this (holder, policy_id) already exists.
    DuplicatePolicyId = 101,
    /// Coverage must be > 0.
    InvalidCoverage = 102,
    /// Computed premium is zero or negative.
    InvalidPremium = 103,
    /// Premium computation overflowed.
    PremiumOverflow = 104,
    /// Policy duration would overflow ledger sequence.
    LedgerOverflow = 105,
    /// Policy struct failed internal validation.
    PolicyValidation = 106,
    /// Invalid or empty metadata URI.
    InvalidMetadataUri = 120,
    /// Caller is not authorized.
    Unauthorized = 107,
    /// Age out of range (1..=120).
    InvalidAge = 108,
    /// Risk score out of range (0..=100).
    InvalidRiskScore = 109,
    /// Supplied asset is not on the admin-controlled allowlist.
    AssetNotAllowed = 110,
    /// Policy not found.
    NotFound = 111,
    /// Policy is already active.
    AlreadyActive = 112,
    /// Keeper `process_expired`: policy is not yet at `end_ledger`.
    NotYetExpired = 113,
    /// `renew_policy` called before the renewal window opens.
    NotInRenewalWindow = 114,
    /// `renew_policy`: policy is inactive (terminated or deactivated).
    PolicyInactive = 115,
    /// `renew_policy`: an open claim exists for this policy.
    OpenClaimBlocksRenewal = 116,
    /// `renew_policy`: strike count blocks renewal (see `STRIKE_DEACTIVATION_THRESHOLD`).
    TooManyStrikesForRenewal = 117,
    /// Reserved / legacy: expired renewals now return [`crate::types::RenewPolicyOutcome::Lapsed`] `Ok`.
    Expired = 118,
    /// Supplied `expected_nonce` does not match the holder's current on-chain nonce.
    NonceMismatch = 119,
    /// Region code not found in the admin-managed region registry, or region is deactivated.
    InvalidRegion = 121,
    /// KYC whitelist is enabled and the holder is not in the whitelist.
    NotWhitelisted = 122,
    /// Deductible value is invalid (negative or exceeds coverage).
    InvalidDeductible = 123,
    /// Treasury balance is insufficient to cover projected claim obligations.
    InsufficientSolvency = 124,
    /// Terms hash is all-zero (uninitialized). A non-zero SHA-256 digest is required at bind time.
    InvalidTermsHash = 125,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QuoteFailure {
    pub code: u32,
    pub message: String,
}

/// Versioned event emitted by `initiate_policy`.
#[contractevent]
#[derive(Clone, Debug)]
pub struct PolicyInitiated {
    #[topic]
    pub holder: Address,
    pub version: u32,
    pub policy_id: u32,
    pub premium: i128,
    pub asset: Address,
    pub policy_type: PolicyType,
    pub region: RegionTier,
    pub coverage: i128,
    /// Per-claim deductible in policy asset units (`None` = zero).
    pub deductible: Option<i128>,
    pub start_ledger: u32,
    pub end_ledger: u32,
    /// SHA-256 hash of the insurance terms document bound at policy initiation.
    /// Non-zero; uniquely identifies the exact terms version in effect.
    pub terms_hash: BytesN<32>,
}

/// Emitted when a protocol fee is collected from a premium payment.
#[contractevent(topics = ["niffyinsure", "protocol_fee_collected"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolFeeCollected {
    #[topic]
    pub policy_id: u32,
    pub version: u32,
    pub fee_amount: i128,
    pub recipient: Address,
}

/// Emitted when the payout beneficiary is set or changed (including at policy initiation when non-empty).
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BeneficiaryUpdated {
    #[topic]
    pub holder: Address,
    #[topic]
    pub policy_id: u32,
    pub old_beneficiary: Option<Address>,
    pub new_beneficiary: Option<Address>,
}

/// Emitted when the policy metadata URI is updated.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolicyMetadataUpdated {
    #[topic]
    pub holder: Address,
    #[topic]
    pub policy_id: u32,
    pub old_uri: String,
    pub new_uri: String,
}

/// Event emitted by `renew_policy`.
#[contractevent]
#[derive(Clone, Debug)]
pub struct PolicyRenewed {
    #[topic]
    pub holder: Address,
    pub version: u32,
    pub policy_id: u32,
    pub premium: i128,
    pub new_end_ledger: u32,
    pub old_coverage_type: CoverageType,
    pub new_coverage_type: CoverageType,
    pub old_coverage: i128,
    pub new_coverage: i128,
}

/// Emitted at most once per `(holder, policy_id, end_ledger)` term when expiry is detected.
///
/// **Timing:** `reported_at_ledger` is the ledger of the transaction that observes expiry.
/// It may be **strictly greater** than `expiry_ledger` if no call ran exactly at expiry
/// (keeper delay is normal). Indexers and notification services should **deduplicate on
/// `policy_id`** (and holder) and must not assume the event fires on the expiry ledger itself.
///
/// **`renew_policy` on an expired policy:** the call returns [`crate::types::RenewPolicyOutcome::Lapsed`]
/// in **`Ok`** (not `Err`) so this event and idempotency storage are not rolled back.
pub fn generate_premium(
    env: &Env,
    region: RegionTier,
    age_band: AgeBand,
    coverage_type: CoverageTier,
    safety_score: u32,
    base_amount: i128,
    include_breakdown: bool,
    asset: Option<&Address>,
) -> Result<PremiumQuote, validate::Error> {
    let input = RiskInput {
        region,
        age_band,
        coverage: coverage_type,
        safety_score,
    };

    validate::check_risk_input(&input)?;
    if base_amount <= 0 {
        return Err(validate::Error::InvalidBaseAmount);
    }

    let table = match asset {
        Some(a) => premium::get_table_for_asset(env, a),
        None => storage::get_multiplier_table(env),
    };
    let computation = premium::compute_premium(&input, base_amount, &table)?;
    let line_items = if include_breakdown {
        Some(premium::build_line_items(env, &computation))
    } else {
        None
    };

    let current_ledger = env.ledger().sequence();
    let valid_until_ledger = current_ledger
        .checked_add(QUOTE_TTL_LEDGERS)
        .ok_or(validate::Error::Overflow)?;

    Ok(PremiumQuote {
        total_premium: computation.total_premium,
        line_items,
        valid_until_ledger,
        config_version: computation.config_version,
    })
}

pub fn map_quote_error(env: &Env, err: Error) -> QuoteFailure {
    let message = match err {
        Error::InvalidBaseAmount => "invalid base amount: expected > 0",
        Error::SafetyScoreOutOfRange => "invalid safety_score: expected 0..=100",
        Error::InvalidConfigVersion => {
            "invalid premium table version: expected a strictly newer version"
        }
        Error::MissingRegionMultiplier => "premium table missing one or more region multipliers",
        Error::MissingAgeMultiplier => "premium table missing one or more age-band multipliers",
        Error::MissingCoverageMultiplier => {
            "premium table missing one or more coverage multipliers"
        }
        Error::RegionMultiplierOutOfBounds => {
            "region multiplier out of bounds: expected 0.5000x..=5.0000x"
        }
        Error::AgeMultiplierOutOfBounds => {
            "age-band multiplier out of bounds: expected 0.5000x..=5.0000x"
        }
        Error::CoverageMultiplierOutOfBounds => {
            "coverage multiplier out of bounds: expected 0.5000x..=5.0000x"
        }
        Error::SafetyDiscountOutOfBounds => {
            "safety discount out of bounds: expected 0.0000x..=0.5000x"
        }
        Error::Overflow => "pricing arithmetic overflow: reduce base amount or multiplier values",
        Error::DivideByZero => "pricing divide by zero: check configured scaling factors",
        Error::InvalidQuoteTtl => "quote ttl misconfigured: contact support",
        Error::NegativePremiumNotSupported => "negative premium inputs are not supported",
        Error::ClaimNotFound => "claim not found",
        Error::InvalidAsset => "claim asset is not allowlisted for payout",
        Error::InsufficientTreasury => "treasury balance is insufficient for the approved payout",
        Error::AlreadyPaid => "claim payout already executed",
        Error::ClaimNotApproved => "claim must be approved before payout",
        Error::DuplicateOpenClaim => "an open claim already exists for this policy",
        Error::ZeroCoverage => "policy coverage must be greater than zero",
        Error::ZeroPremium => "policy premium must be greater than zero",
        Error::InvalidLedgerWindow => {
            "invalid ledger window: end_ledger must be greater than start_ledger"
        }
        Error::PolicyExpired => "policy is expired",
        Error::PolicyInactive => "policy is inactive",
        Error::ClaimAmountZero => "claim amount must be greater than zero",
        Error::ClaimExceedsCoverage => "claim amount exceeds policy coverage",
        Error::PolicyNotFound => "policy not found",
        Error::ExcessiveEvidenceBytes => {
            "claim evidence rejected: invalid commitment (e.g. all-zero SHA-256) or payload over limit"
        }
        Error::DetailsTooLong => "claim details exceed maximum length",
        Error::TooManyImageUrls => "too many image URLs supplied",
        Error::ImageUrlTooLong => "image URL exceeds maximum length",
        Error::ReasonTooLong => "termination reason exceeds maximum length",
        Error::ClaimAlreadyTerminal => {
            "claim already terminal, or withdrawal blocked (voting started or not Processing)"
        }
        Error::DuplicateVote => "duplicate vote detected",
        Error::CalculatorNotSet => "no external calculator configured",
        Error::CalculatorCallFailed => "cross-contract call to premium calculator failed",
        Error::CalculatorPaused => {
            "premium calculator is paused; policy bind rejected; or claims_paused blocks finalize_claim / process_deadline"
        }
        Error::VotingWindowClosed => "voting window has closed; use finalize_claim",
        Error::VotingWindowStillOpen => "voting window is still open; cannot finalize yet",
        Error::NotEligibleVoter => {
            "caller is not in the claim voter snapshot, or is not the claimant for withdraw_claim"
        }
        Error::RateLimitExceeded => "claim rate-limit: wait before filing another claim",
        Error::VotingDurationOutOfBounds => {
            "voting duration ledgers outside allowed min/max; see contract docs"
        },
        Error::PolicyBatchTooLarge => "batch exceeds maximum allowed keys per call",
        Error::VoterSnapshotExpired => {
            "claim voter snapshot expired or missing; run refresh_snapshot before voting ends"
        },
        Error::NonceMismatch => {
            "nonce mismatch: read current nonce via get_nonce(holder) and retry"
        },
        Error::ClaimNotProcessing => {
            "claim is not in Processing status; process_deadline requires Processing"
        },
        Error::RollingClaimCapExceeded => {
            "rolling claim cap exceeded: total paid claims for this policy exceed the configured cap for this window"
        },
        Error::PayoutDeadlineNotReached => {
            "payout timeout is not yet due: the approved claim must wait for its deadline to pass"
        },
        Error::VoteDelegated => "direct vote rejected because the caller has an active delegation",
        Error::CircularDelegation => "delegation would create a cycle",
        Error::ProtocolFeeOutOfBounds => {
            "protocol fee basis points exceed the configured maximum"
        },
        Error::SolvencyRatioOutOfBounds => {
            "minimum solvency ratio basis points outside documented bounds"
        },
        Error::ClaimBatchTooLarge => "claim batch exceeds maximum allowed IDs per call",
        Error::InvalidEvidenceUrl => "evidence URL does not match IPFS or allowlisted gateway format",
        Error::ClaimEvidenceUpdateNotAllowed => {
            "claim evidence cannot be updated after voting has started"
        }
        Error::EvidenceCountOutOfBounds => "evidence count is outside configured min/max bounds",
        Error::ZeroTreasuryDeposit => "treasury deposit amount must be greater than zero",
        Error::UnauthorizedTreasuryDepositor => {
            "caller is not authorized to deposit treasury capital"
        }
        Error::PayoutRecipientContractNotAllowlisted => {
            "contract payout recipient is not on the allowlist"
        }
        Error::ClaimBelowMinAmount => "claim amount is below the asset-specific minimum",
        Error::ClaimAboveMaxAmount => "claim amount exceeds the asset-specific maximum",
        Error::DelegationInvalid => "delegation not found or expired",
        Error::DelegationPermissionDenied => "operator lacks required delegation permission",
        Error::NoReinsuranceConfigured => {
            "primary treasury insufficient and no reinsurance configured"
        }
        Error::OverDisbursement => "installment amount exceeds remaining unpaid claim balance",
        Error::PolicyTransferInvalid => "policy transfer target is invalid",
        Error::DisputeWindowActive => "payout blocked while dispute window is active",
        Error::AppealWindowClosed => "appeal window has closed",
        Error::AppealAlreadyUsed => "claim has already used its allowed appeal",
        Error::InsufficientEvidence => "claim evidence count is below the minimum requirement",
        Error::CooldownActive => "policy claim cooldown window has not elapsed",
        Error::CalculatorVersionMismatch => {
            "premium calculator ABI version is incompatible with this contract"
        }
        Error::CommitRevealNotSet => "commit-reveal voting phases are not configured for this claim",
        Error::CommitPhaseEnded => "commit phase has ended for this claim",
        Error::RevealPhaseNotOpen => "reveal phase is not open yet for this claim",
        Error::RevealPhaseEnded => "reveal phase has ended for this claim",
        Error::CommitmentNotFound => "no vote commitment found for this voter",
        Error::CommitmentMismatch => "revealed vote does not match the prior commitment",
        Error::DuplicateEvidence => "evidence array contains a duplicate url/hash pair",
        Error::SelfVoteNotAllowed => "claimant cannot vote on their own claim",
        Error::PageSizeTooLarge => "requested page size exceeds the hard query cap",
        Error::EscalationDeadlineNotFuture => "escalation deadline must be in the future",
        Error::EscalationDeadlineNotEarlier => {
            "escalation deadline must be earlier than the current voting deadline"
        }
        Error::DuplicateEvidence => "claim evidence contains a duplicate entry",
        Error::PageSizeTooLarge => "requested page_size exceeds the hard cap",
    };
    QuoteFailure {
        code: err as u32,
        message: String::from_str(env, message),
    }
}

/// Returns true when treasury balance covers approved obligations plus `new_coverage`
/// at or above the configured minimum solvency ratio.
pub fn check_solvency_ratio(env: &Env, asset: &Address, new_coverage: i128) -> bool {
    let min_ratio_bps = storage::get_min_solvency_ratio_bps(env);
    if min_ratio_bps == 0 {
        return true;
    }
    if new_coverage < 0 {
        return false;
    }

    let obligations =
        storage::outstanding_approved_claim_obligations(env, asset).saturating_add(new_coverage);
    if obligations <= 0 {
        return true;
    }

    let balance = token::get_treasury_balance(env, asset);
    if balance < 0 {
        return false;
    }

    let Some(numerator) = balance.checked_mul(10_000) else {
        return true;
    };
    numerator / obligations >= min_ratio_bps as i128
}

/// Turns an accepted quote into an enforceable on-chain policy.
///
/// # Asset
/// `asset` must be on the admin-controlled allowlist at call time.
/// The asset is bound to the policy and used for both premium payment
/// and future claim payouts — no cross-asset settlement in MVP.
#[allow(clippy::too_many_arguments)]
pub fn initiate_policy(
    env: &Env,
    holder: Address,
    policy_type: PolicyType,
    region: RegionTier,
    age_band: AgeBand,
    coverage_type: CoverageTier,
    safety_score: u32,
    base_amount: i128,
    asset: Address,
    beneficiary: Option<Address>,
    deductible: Option<i128>,
    expected_nonce: Option<u64>,
    metadata_uri: String,
    region_code: Option<String>,
    terms_hash: BytesN<32>,
) -> Result<Policy, PolicyError> {
    // Check granular pause: policy binding should be blocked if bind_paused
    storage::assert_bind_not_paused(env);

    // Policy type registry check: if the registry is enabled, the requested type
    // must be registered and active. If the registry has never been used, all types
    // are allowed for backward compatibility with pre-registry deployments.
    if storage::is_policy_type_registry_enabled(env)
        && !storage::is_policy_type_active(env, &policy_type)
    {
        return Err(PolicyError::AssetNotAllowed);
    }

    // Asset allowlist check — before auth so callers get a clear error.
    if !storage::is_allowed_asset(env, &asset) {
        return Err(PolicyError::AssetNotAllowed);
    }

    // KYC whitelist check: if enabled, the holder must be explicitly whitelisted.
    if storage::is_whitelist_enabled(env) && !storage::is_whitelisted(env, &holder) {
        return Err(PolicyError::NotWhitelisted);
    }

    // Region registry validation: if the registry is non-empty, the supplied
    // region_code must exist and be active.
    let region_registry = storage::get_region_registry(env);
    let region_risk_multiplier = if region_registry.is_empty() {
        premium::SCALE
    } else {
        let code = region_code.ok_or(PolicyError::InvalidRegion)?;
        let config = region_registry
            .get(code)
            .ok_or(PolicyError::InvalidRegion)?;
        if !config.active {
            return Err(PolicyError::InvalidRegion);
        }
        config.risk_multiplier
    };

    holder.require_auth();

    // Opt-in replay protection: check and increment per-holder nonce if provided.
    storage::check_and_bump_nonce(env, &holder, expected_nonce)
        .map_err(|_| PolicyError::NonceMismatch)?;

    let input = RiskInput {
        region: region.clone(),
        age_band: age_band.clone(),
        coverage: coverage_type,
        safety_score,
    };

    if safety_score > 100 {
        return Err(PolicyError::InvalidRiskScore);
    }
    if base_amount <= 0 {
        return Err(PolicyError::InvalidCoverage);
    }
    // Terms hash must be non-zero: all-zero digest is rejected as uninitialized.
    if terms_hash == BytesN::from_array(env, &[0u8; 32]) {
        return Err(PolicyError::InvalidTermsHash);
    }
    if !check_solvency_ratio(env, &asset, base_amount) {
        return Err(PolicyError::InsufficientSolvency);
    }

    let deductible_stored = match deductible {
        None => None,
        Some(0) => None,
        Some(d) if d < 0 => return Err(PolicyError::InvalidDeductible),
        Some(d) if d > base_amount => return Err(PolicyError::InvalidDeductible),
        Some(d) => Some(d),
    };

    // Compute premium via the calculator (external or local fallback).
    // Pass the policy asset so asset-specific tables are used when configured.
    let quote = crate::calculator::compute_quote(
        env,
        &input,
        base_amount,
        false,
        QUOTE_TTL_LEDGERS,
        Some(&asset),
    )
    .map_err(|e| match e {
        validate::Error::CalculatorPaused => PolicyError::ContractPaused,
        validate::Error::CalculatorCallFailed | validate::Error::CalculatorNotSet => {
            PolicyError::PremiumOverflow
        }
        _ => PolicyError::PremiumOverflow,
    })?;
    let premium_amount = premium::checked_mul_ratio(
        quote.total_premium,
        region_risk_multiplier,
        premium::SCALE,
        premium::Rounding::Ceil,
    )
    .map_err(|_| PolicyError::PremiumOverflow)?;
    if premium_amount <= 0 {
        return Err(PolicyError::InvalidPremium);
    }

    let fee_bps = storage::get_protocol_fee_bps(env);
    let fee_recipient = storage::get_fee_recipient(env);
    let fee_amount = if fee_bps == 0 {
        0
    } else {
        premium_amount
            .checked_mul(fee_bps as i128)
            .ok_or(PolicyError::PremiumOverflow)?
            / 10_000
    };
    let treasury_amount = premium_amount
        .checked_sub(fee_amount)
        .ok_or(PolicyError::PremiumOverflow)?;

    // Allocate unique per-holder policy_id.
    let policy_id = storage::next_policy_id(env, &holder);

    if storage::has_policy(env, &holder, policy_id) {
        return Err(PolicyError::DuplicatePolicyId);
    }

    // Premium transfer: holder -> treasury and fee recipient using the policy's bound asset.
    // Done BEFORE any durable writes so failure leaves no partial state.
    token::collect_premium_with_fee(
        env,
        &holder,
        &asset,
        treasury_amount,
        &fee_recipient,
        fee_amount,
    );

    let current_ledger = env.ledger().sequence();
    let end_ledger = current_ledger
        .checked_add(ledger::POLICY_DURATION_LEDGERS)
        .ok_or(PolicyError::LedgerOverflow)?;

    let policy = Policy {
        holder: holder.clone(),
        policy_id,
        policy_type: policy_type.clone(),
        region: region.clone(),
        premium: premium_amount,
        coverage: base_amount,
        is_active: true,
        start_ledger: current_ledger,
        end_ledger,
        asset: asset.clone(),
        deductible: deductible_stored,
        beneficiary: beneficiary.clone(),
        terminated_at_ledger: 0,
        termination_reason: crate::types::TerminationReason::None,
        terminated_by_admin: false,
        strike_count: 0,
        metadata_uri,
        terms_hash: terms_hash.clone(),
    };

    validate::check_policy(&policy).map_err(|_| PolicyError::PolicyValidation)?;

    storage::set_policy(env, &holder, policy_id, &policy);
    storage::add_voter(env, &holder);

    if fee_amount > 0 {
        ProtocolFeeCollected {
            policy_id,
            version: POLICY_EVENT_VERSION,
            fee_amount,
            recipient: fee_recipient.clone(),
        }
        .publish(env);
    }

    PolicyInitiated {
        version: POLICY_EVENT_VERSION,
        policy_id,
        holder: holder.clone(),
        premium: premium_amount,
        asset: asset.clone(),
        policy_type,
        region,
        coverage: base_amount,
        deductible: deductible_stored,
        start_ledger: current_ledger,
        end_ledger,
        terms_hash,
    }
    .publish(env);

    if let Some(ref b) = beneficiary {
        BeneficiaryUpdated {
            holder: holder.clone(),
            policy_id,
            old_beneficiary: None,
            new_beneficiary: Some(b.clone()),
        }
        .publish(env);
    }

    Ok(policy)
}

/// Update the optional payout beneficiary. Only the policy holder may call (authenticated via `holder`).
///
/// Admin cannot change this without the holder signing the transaction.
pub fn set_beneficiary(
    env: &Env,
    holder: Address,
    policy_id: u32,
    new_beneficiary: Option<Address>,
) -> Result<(), PolicyError> {
    holder.require_auth();

    let mut policy = storage::get_policy(env, &holder, policy_id).ok_or(PolicyError::NotFound)?;

    if policy.holder != holder {
        return Err(PolicyError::Unauthorized);
    }

    let old_beneficiary = policy.beneficiary.clone();
    if old_beneficiary == new_beneficiary {
        return Ok(());
    }

    policy.beneficiary = new_beneficiary.clone();
    validate::check_policy(&policy).map_err(|_| PolicyError::PolicyValidation)?;
    storage::set_policy(env, &holder, policy_id, &policy);

    BeneficiaryUpdated {
        holder: holder.clone(),
        policy_id,
        old_beneficiary,
        new_beneficiary,
    }
    .publish(env);

    Ok(())
}

/// Admin-only: update the policy metadata URI. Must be non-empty.
pub fn update_policy_metadata_uri(
    env: &Env,
    holder: Address,
    policy_id: u32,
    new_uri: String,
) -> Result<(), PolicyError> {
    // Validate new_uri is non-empty
    if new_uri.is_empty() {
        return Err(PolicyError::InvalidMetadataUri);
    }

    let mut policy = storage::get_policy(env, &holder, policy_id).ok_or(PolicyError::NotFound)?;

    let old_uri = policy.metadata_uri.clone();
    if old_uri == new_uri {
        return Ok(());
    }

    policy.metadata_uri = new_uri.clone();
    storage::set_policy(env, &holder, policy_id, &policy);

    PolicyMetadataUpdated {
        holder: holder.clone(),
        policy_id,
        old_uri,
        new_uri,
    }
    .publish(env);

    Ok(())
}

// ── Grace period admin setter ─────────────────────────────────────────────────

#[contractevent(topics = ["niffyinsure", "grace_period_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GracePeriodUpdated {
    pub old_ledgers: u32,
    pub new_ledgers: u32,
}

pub fn set_grace_period_ledgers(env: &Env, ledgers: u32) -> Result<(), RenewalError> {
    let admin = crate::admin::require_admin(env);
    crate::admin::check_and_update_gov_cooldown(env);
    if !ledger::is_valid_grace_period_ledgers(ledgers) {
        return Err(RenewalError::GracePeriodOutOfBounds);
    }
    let old = storage::get_grace_period_ledgers(env);
    storage::set_grace_period_ledgers(env, ledgers);
    GracePeriodUpdated {
        old_ledgers: old,
        new_ledgers: ledgers,
    }
    .publish(env);
    crate::admin::emit_admin_action(env, &admin, "set_grace_period_ledgers");
    Ok(())
}

pub fn get_grace_period_ledgers(env: &Env) -> u32 {
    storage::get_grace_period_ledgers(env)
}

// ── renew_policy ──────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RenewalError {
    /// Policy not found.
    NotFound = 200,
    /// Policy is not active.
    Inactive = 201,
    /// Current ledger is outside the renewal + grace window.
    WindowClosed = 202,
    /// An open claim is blocking renewal.
    OpenClaimBlocking = 203,
    /// Premium computation failed.
    PremiumError = 204,
    /// Ledger arithmetic overflow.
    LedgerOverflow = 205,
    /// Grace period value outside allowed [min, max] range.
    GracePeriodOutOfBounds = 206,
    /// Renewed coverage is incompatible with stored deductible (see `check_policy`).
    InvalidDeductible = 207,
}

/// Emit [`PolicyExpired`] if `now >= end_ledger` and we have not yet recorded an event for this term.
pub fn publish_policy_expired_if_due(env: &Env, policy: &Policy, now: u32) {
    if !ledger::is_expired(now, policy.end_ledger) {
        return;
    }
    if storage::get_policy_expired_event_end_ledger(env, &policy.holder, policy.policy_id)
        == Some(policy.end_ledger)
    {
        return;
    }
    events::emit_policy_expired(
        env,
        &policy.holder,
        policy.policy_id,
        policy.end_ledger,
        now,
    );
    storage::set_policy_expired_event_end_ledger(
        env,
        &policy.holder,
        policy.policy_id,
        policy.end_ledger,
    );
    storage::bump_instance(env);
}

/// Keeper entrypoint: observe expiry for indexers / notification pipelines.
///
/// Reverts with [`PolicyError::NotYetExpired`] if `now < end_ledger`. If expiry was already
/// notified for this policy term, succeeds without emitting a duplicate event.
pub fn process_expired(env: &Env, holder: Address, policy_id: u32) -> Result<(), PolicyError> {
    storage::bump_instance(env);
    let policy = storage::get_policy(env, &holder, policy_id).ok_or(PolicyError::NotFound)?;
    let now = env.ledger().sequence();
    if !ledger::is_expired(now, policy.end_ledger) {
        return Err(PolicyError::NotYetExpired);
    }
    publish_policy_expired_if_due(env, &policy, now);
    Ok(())
}

/// Extend policy duration after premium payment (renewal window only).
///
/// If the policy is already expired, records [`PolicyExpired`] if not yet recorded for this
/// term, then returns [`crate::types::RenewPolicyOutcome::Lapsed`] in **`Ok`** so storage and
/// events persist (an `Err` would roll back the contract invocation).
#[allow(clippy::too_many_arguments)]
pub fn renew_policy(
    env: &Env,
    holder: Address,
    policy_id: u32,
    age_band: AgeBand,
    coverage_type: CoverageType,
    safety_score: u32,
    new_coverage_tier: Option<CoverageType>,
    new_coverage_amount: Option<i128>,
) -> Result<crate::types::RenewPolicyOutcome, PolicyError> {
    storage::assert_bind_not_paused(env);
    holder.require_auth();

    let mut policy = storage::get_policy(env, &holder, policy_id).ok_or(PolicyError::NotFound)?;
    let now = env.ledger().sequence();
    let grace = storage::get_grace_period_ledgers(env);

    if ledger::is_expired(now, policy.end_ledger.saturating_add(grace)) {
        publish_policy_expired_if_due(env, &policy, now);
        return Ok(crate::types::RenewPolicyOutcome::Lapsed);
    }

    if !policy.is_active {
        return Err(PolicyError::PolicyInactive);
    }

    if storage::has_open_claim(env, &holder, policy_id) {
        return Err(PolicyError::OpenClaimBlocksRenewal);
    }

    if policy.strike_count >= STRIKE_DEACTIVATION_THRESHOLD {
        return Err(PolicyError::TooManyStrikesForRenewal);
    }

    if !ledger::is_in_renewal_window_with_grace(
        now,
        policy.end_ledger,
        ledger::RENEWAL_WINDOW_LEDGERS,
        grace,
    ) {
        return Err(PolicyError::NotInRenewalWindow);
    }

    if safety_score > 100 {
        return Err(PolicyError::InvalidRiskScore);
    }

    if !storage::is_allowed_asset(env, &policy.asset) {
        return Err(PolicyError::AssetNotAllowed);
    }

    let effective_coverage_type = new_coverage_tier.unwrap_or_else(|| coverage_type.clone());
    let effective_coverage_amount = new_coverage_amount.unwrap_or(policy.coverage);
    if coverage_tier_rank(&effective_coverage_type) < coverage_tier_rank(&coverage_type)
        || effective_coverage_amount < policy.coverage
    {
        return Err(PolicyError::InvalidCoverage);
    }

    let input = RiskInput {
        region: policy.region.clone(),
        age_band: age_band.clone(),
        coverage: effective_coverage_type.clone(),
        safety_score,
    };

    let quote = crate::calculator::compute_quote(
        env,
        &input,
        policy.coverage,
        false,
        QUOTE_TTL_LEDGERS,
        Some(&policy.asset),
    )
    .map_err(|e| match e {
        Error::CalculatorPaused => PolicyError::ContractPaused,
        Error::CalculatorCallFailed | Error::CalculatorNotSet => PolicyError::PremiumOverflow,
        _ => PolicyError::PremiumOverflow,
    })?;

    let premium_amount = quote.total_premium;
    if premium_amount <= 0 {
        return Err(PolicyError::InvalidPremium);
    }

    token::collect_premium(env, &holder, &policy.asset, premium_amount);

    let new_end = policy
        .end_ledger
        .checked_add(ledger::POLICY_DURATION_LEDGERS)
        .ok_or(PolicyError::LedgerOverflow)?;

    let old_coverage = policy.coverage;
    policy.premium = premium_amount;
    policy.coverage = effective_coverage_amount;
    policy.end_ledger = new_end;

    validate::check_policy(&policy).map_err(|_| PolicyError::PolicyValidation)?;

    storage::set_policy(env, &holder, policy_id, &policy);

    // Rolling claim cap resets for the renewed policy term (see rolling_claim_cap module docs).
    crate::rolling_claim_cap::reset_on_renewal(env, &holder, policy_id, now);

    PolicyRenewed {
        version: POLICY_EVENT_VERSION,
        holder: holder.clone(),
        policy_id,
        premium: premium_amount,
        new_end_ledger: new_end,
        old_coverage_type: coverage_type,
        new_coverage_type: effective_coverage_type,
        old_coverage,
        new_coverage: effective_coverage_amount,
    }
    .publish(env);

    Ok(crate::types::RenewPolicyOutcome::Renewed(policy))
}

fn coverage_tier_rank(tier: &CoverageType) -> u32 {
    match tier {
        CoverageType::Basic => 0,
        CoverageType::Standard => 1,
        CoverageType::Premium => 2,
    }
}

/// Transfer policy ownership to a new holder.
///
/// - Authenticated by the current holder.
/// - Reverts if `new_holder` equals the current holder or if any claim is open.
pub fn transfer_policy(
    env: &Env,
    holder: &Address,
    policy_id: u32,
    new_holder: &Address,
) -> Result<(), Error> {
    holder.require_auth();

    if holder == new_holder {
        return Err(Error::PolicyTransferInvalid);
    }

    let mut policy = storage::get_policy(env, holder, policy_id).ok_or(Error::PolicyNotFound)?;

    if !policy.is_active {
        return Err(Error::PolicyInactive);
    }

    // Block transfer while an open claim exists for this policy
    if storage::get_open_claim_count(env, holder, policy_id) > 0 {
        return Err(Error::PolicyTransferInvalid);
    }

    // Move storage: write under new holder key, remove old key
    policy.holder = new_holder.clone();
    storage::set_policy(env, new_holder, policy_id, &policy);
    env.storage()
        .persistent()
        .remove(&storage::DataKey::Policy(holder.clone(), policy_id));

    events::emit_policy_transferred(env, policy_id, holder, new_holder);

    Ok(())
}
