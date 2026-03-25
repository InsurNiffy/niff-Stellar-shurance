use crate::{
    calculator,
    ledger,
    premium,
    storage,
    token,
    types::{AgeBand, CoverageType, Policy, PolicyType, PremiumQuote, RegionTier, RiskInput},
    validate::{self, Error},
};
use soroban_sdk::{contractevent, contracterror, contracttype, symbol_short, Address, Env, String};

pub use ledger::QUOTE_TTL_LEDGERS;

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
    pub start_ledger: u32,
    pub end_ledger: u32,
}

/// Event emitted by `renew_policy`.
#[contractevent]
#[derive(Clone, Debug)]
pub struct PolicyRenewed {
    #[topic]
    pub holder: Address,
    pub policy_id: u32,
    pub premium: i128,
    pub new_end_ledger: u32,
}

pub fn generate_premium(
    env: &Env,
    region: RegionTier,
    age_band: AgeBand,
    coverage_type: CoverageType,
    safety_score: u32,
    base_amount: i128,
    include_breakdown: bool,
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

    let table = storage::get_multiplier_table(env);
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
        Error::InvalidConfigVersion => "invalid premium table version: expected a strictly newer version",
        Error::MissingRegionMultiplier => "premium table missing one or more region multipliers",
        Error::MissingAgeMultiplier => "premium table missing one or more age-band multipliers",
        Error::MissingCoverageMultiplier => "premium table missing one or more coverage multipliers",
        Error::RegionMultiplierOutOfBounds => "region multiplier out of bounds: expected 0.5000x..=5.0000x",
        Error::AgeMultiplierOutOfBounds => "age-band multiplier out of bounds: expected 0.5000x..=5.0000x",
        Error::CoverageMultiplierOutOfBounds => "coverage multiplier out of bounds: expected 0.5000x..=5.0000x",
        Error::SafetyDiscountOutOfBounds => "safety discount out of bounds: expected 0.0000x..=0.5000x",
        Error::Overflow => "pricing arithmetic overflow: reduce base amount or multiplier values",
        Error::DivideByZero => "pricing divide by zero: check configured scaling factors",
        Error::InvalidQuoteTtl => "quote ttl misconfigured: contact support",
        Error::NegativePremiumNotSupported => "negative premium inputs are not supported",
        Error::ClaimNotFound => "claim not found",
        Error::InvalidAsset => "claim asset is not allowlisted for payout",
        Error::InsufficientTreasury => "treasury balance is insufficient for the approved payout",
        Error::AlreadyPaid => "claim payout already executed",
        Error::ClaimNotApproved => "claim must be approved before payout",
        Error::ZeroCoverage => "policy coverage must be greater than zero",
        Error::ZeroPremium => "policy premium must be greater than zero",
        Error::InvalidLedgerWindow => "invalid ledger window: end_ledger must be greater than start_ledger",
        Error::PolicyExpired => "policy is expired",
        Error::PolicyInactive => "policy is inactive",
        Error::ClaimAmountZero => "claim amount must be greater than zero",
        Error::ClaimExceedsCoverage => "claim amount exceeds policy coverage",
        Error::DetailsTooLong => "claim details exceed maximum length",
        Error::TooManyImageUrls => "too many image URLs supplied",
        Error::ImageUrlTooLong => "image URL exceeds maximum length",
        Error::ReasonTooLong => "termination reason exceeds maximum length",
        Error::ClaimAlreadyTerminal => "claim already reached a terminal status",
        Error::DuplicateVote => "duplicate vote detected",
        Error::CalculatorNotSet => "no external calculator configured",
        Error::CalculatorCallFailed => "cross-contract call to premium calculator failed",
        Error::CalculatorPaused => "premium calculator is paused; policy bind rejected",
        Error::VotingWindowClosed => "voting window has closed; use finalize_claim",
        Error::VotingWindowStillOpen => "voting window is still open; cannot finalize yet",
        Error::NotEligibleVoter => "caller is not in the claim voter snapshot",
        Error::RateLimitExceeded => "claim rate-limit: wait before filing another claim",
    };
    QuoteFailure {
        code: err as u32,
        message: String::from_str(env, message),
    }
}

/// Turns an accepted quote into an enforceable on-chain policy.
///
/// # Asset
/// `asset` must be on the admin-controlled allowlist at call time.
/// The asset is bound to the policy and used for both premium payment
/// and future claim payouts — no cross-asset settlement in MVP.
pub fn initiate_policy(
    env: &Env,
    holder: Address,
    policy_type: PolicyType,
    region: RegionTier,
    age_band: AgeBand,
    coverage_type: CoverageType,
    safety_score: u32,
    base_amount: i128,
    asset: Address,
) -> Result<Policy, PolicyError> {
    if storage::is_paused(env) {
        return Err(PolicyError::ContractPaused);
    }

    // Asset allowlist check — before auth so callers get a clear error.
    if !storage::is_allowed_asset(env, &asset) {
        return Err(PolicyError::AssetNotAllowed);
    }

    holder.require_auth();

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

    // Compute premium via the calculator (external or local fallback).
    let quote = crate::calculator::compute_quote(env, &input, base_amount, false, QUOTE_TTL_LEDGERS)
        .map_err(|e| match e {
            validate::Error::CalculatorPaused => PolicyError::ContractPaused,
            validate::Error::CalculatorCallFailed | validate::Error::CalculatorNotSet => PolicyError::PremiumOverflow,
            _ => PolicyError::PremiumOverflow,
        })?;
    let premium_amount = quote.total_premium;
    if premium_amount <= 0 {
        return Err(PolicyError::InvalidPremium);
    }

    // Allocate unique per-holder policy_id.
    let policy_id = storage::next_policy_id(env, &holder);

    if storage::has_policy(env, &holder, policy_id) {
        return Err(PolicyError::DuplicatePolicyId);
    }

    // Premium transfer: holder -> treasury using the policy's bound asset.
    // Done BEFORE any durable writes so failure leaves no partial state.
    token::collect_premium(env, &holder, &asset, premium_amount);

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
    };

    validate::check_policy(&policy).map_err(|_| PolicyError::PolicyValidation)?;

    storage::set_policy(env, &holder, policy_id, &policy);
    storage::add_voter(env, &holder);

    PolicyInitiated {
        version: POLICY_EVENT_VERSION,
        policy_id,
        holder: holder.clone(),
        premium: premium_amount,
        asset: asset.clone(),
        policy_type,
        region,
        coverage: base_amount,
        start_ledger: current_ledger,
        end_ledger,
    }
    .publish(env);

    Ok(policy)
}
