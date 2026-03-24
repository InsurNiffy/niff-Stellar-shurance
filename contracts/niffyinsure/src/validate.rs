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
    /// Arithmetic overflow detected in a checked operation.
    Overflow,
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
