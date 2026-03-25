use soroban_sdk::{contracterror, Env, String, Vec};

use crate::types::{
    Claim, MultiplierTable, Policy, RiskInput, SAFETY_SCORE_MAX, DETAILS_MAX_LEN, IMAGE_URLS_MAX,
    IMAGE_URL_MAX_LEN, REASON_MAX_LEN,
};

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
    if claim.status != crate::types::ClaimStatus::Pending {
        return Err(Error::ClaimAlreadyTerminal);
    }
    Ok(())
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
