use crate::{
    premium,
    storage,
    token,
    types::{Policy, PolicyType, PremiumQuote, RegionTier},
    validate,
};
use soroban_sdk::{contractevent, contracterror, contracttype, Address, Env, String};

/// How long a quote stays valid (in ledgers) from generation time.
pub const QUOTE_TTL_LEDGERS: u32 = 100;

/// Default policy duration in ledgers (~30 days at 5s/ledger ≈ 518_400).
pub const POLICY_DURATION_LEDGERS: u32 = 518_400;

/// Current event schema version for PolicyInitiated.
pub const POLICY_EVENT_VERSION: u32 = 1;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum QuoteError {
    InvalidAge = 1,
    InvalidRiskScore = 2,
    InvalidQuoteTtl = 3,
    ArithmeticOverflow = 4,
}

/// Errors specific to policy initiation and lifecycle.
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
    /// Computed premium is zero or negative (should not happen with valid inputs).
    InvalidPremium = 103,
    /// Premium computation overflowed.
    PremiumOverflow = 104,
    /// Policy duration would overflow ledger sequence.
    LedgerOverflow = 105,
    /// Policy struct failed internal validation.
    PolicyValidation = 106,
    /// Caller is not authorized (require_auth failed or wrong signer).
    Unauthorized = 107,
    /// Age out of range (1..=120).
    InvalidAge = 108,
    /// Risk score out of range (1..=10).
    InvalidRiskScore = 109,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QuoteFailure {
    pub code: u32,
    pub message: String,
}

/// Versioned event emitted by `initiate_policy`.
///
/// NestJS indexers subscribe to this event to render dashboards without
/// scanning entire storage.  The `version` field allows the indexer consumer
/// to be versioned alongside contract releases.
///
/// Topic fields (`holder`) are indexed for efficient subscription filtering.
/// Data fields are serialised as a map in the event body.
#[contractevent]
#[derive(Clone, Debug)]
pub struct PolicyInitiated {
    /// Schema version; currently 1.
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

pub fn generate_premium(
    env: &Env,
    input: RiskInput,
    base_amount: i128,
    include_breakdown: bool,
) -> Result<PremiumQuote, Error> {
    validate::check_risk_input(&input)?;
    if base_amount <= 0 {
        return Err(Error::InvalidBaseAmount);
    }
    if QUOTE_TTL_LEDGERS == 0 {
        return Err(Error::InvalidQuoteTtl);
    }

    let table = crate::storage::get_multiplier_table(env);
    let computation = premium::compute_premium(&input, base_amount, &table)?;
    let line_items = if include_breakdown {
        Some(premium::build_line_items(env, &computation))
    } else {
        None
    };

    let current_ledger = env.ledger().sequence();
    let valid_until_ledger = current_ledger
        .checked_add(QUOTE_TTL_LEDGERS)
        .ok_or(Error::Overflow)?;

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
    };
    QuoteFailure {
        code: err as u32,
        message: String::from_str(env, message),
    }
}

/// Turns an accepted quote into an enforceable on-chain policy.
///
/// # Auth
/// `holder.require_auth()` — only the policyholder may initiate.
///
/// # Flow
/// 1. Check contract is not paused.
/// 2. Authenticate the holder.
/// 3. Validate inputs (age, risk_score, coverage).
/// 4. Compute premium via `premium::compute_premium_checked`.
/// 5. Allocate a unique per-holder `policy_id` (idempotent: if a client
///    retries after a failed tx the counter is only bumped on success).
/// 6. Transfer premium from holder → contract address.
/// 7. Persist the `Policy` struct with `is_active = true`.
/// 8. Update voter registry (add holder, increment active-policy count).
/// 9. Emit versioned `PolicyInitiated` event for NestJS indexers.
///
/// All durable writes happen **after** the premium transfer so that a failed
/// transfer leaves zero partial state (no policy, no voter entry).
pub fn initiate_policy(
    env: &Env,
    holder: Address,
    policy_type: PolicyType,
    region: RegionTier,
    coverage: i128,
    age: u32,
    risk_score: u32,
) -> Result<Policy, PolicyError> {
    // 1. Pause guard
    if storage::is_paused(env) {
        return Err(PolicyError::ContractPaused);
    }

    // 2. Authenticate the holder
    holder.require_auth();

    // 3. Input validation
    if age == 0 || age > 120 {
        return Err(PolicyError::InvalidAge);
    }
    if risk_score == 0 || risk_score > 10 {
        return Err(PolicyError::InvalidRiskScore);
    }
    if coverage <= 0 {
        return Err(PolicyError::InvalidCoverage);
    }

    // 4. Compute premium (smallest units / stroops)
    let premium_amount = premium::compute_premium_checked(&policy_type, &region, age, risk_score)
        .ok_or(PolicyError::PremiumOverflow)?;
    if premium_amount <= 0 {
        return Err(PolicyError::InvalidPremium);
    }

    // 5. Allocate unique per-holder policy_id
    let policy_id = storage::next_policy_id(env, &holder);

    // Enforce uniqueness (defensive — next_policy_id is monotonic, but guard
    // against any future code path that might manually set an id).
    if storage::has_policy(env, &holder, policy_id) {
        return Err(PolicyError::DuplicatePolicyId);
    }

    // 6. Premium transfer: holder → contract address
    //    Done BEFORE any durable writes so failure leaves no partial state.
    let token_addr = storage::get_token(env);
    let contract_addr = env.current_contract_address();
    token::transfer(env, &token_addr, &holder, &contract_addr, premium_amount);

    // 7. Build and validate policy struct
    let current_ledger = env.ledger().sequence();
    let end_ledger = current_ledger
        .checked_add(POLICY_DURATION_LEDGERS)
        .ok_or(PolicyError::LedgerOverflow)?;

    let policy = Policy {
        holder: holder.clone(),
        policy_id,
        policy_type: policy_type.clone(),
        region: region.clone(),
        premium: premium_amount,
        coverage,
        is_active: true,
        start_ledger: current_ledger,
        end_ledger,
    };

    // Run structural validation (coverage > 0, premium > 0, ledger window).
    validate::check_policy(&policy).map_err(|_| PolicyError::PolicyValidation)?;

    // 8. Persist policy
    storage::set_policy(env, &holder, policy_id, &policy);

    // 9. Update voter registry
    storage::add_voter(env, &holder);

    // 10. Emit versioned PolicyInitiated event
    PolicyInitiated {
        version: POLICY_EVENT_VERSION,
        policy_id,
        holder: holder.clone(),
        premium: premium_amount,
        asset: token_addr,
        policy_type,
        region,
        coverage,
        start_ledger: current_ledger,
        end_ledger,
    }
    .publish(env);

    Ok(policy)
}
