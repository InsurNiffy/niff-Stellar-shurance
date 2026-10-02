//! Pure premium math — Env-free, shared semantics with `niffyinsure::premium_pure`.
//!
//! `compute` on this contract delegates here so golden vectors stay bit-for-bit
//! aligned with the in-contract engine.

use crate::{
    errors::CalcError,
    types::{AgeBand, CoverageTier, MultiplierTable, RegionTier, SCALE},
};

const PERCENT_SCALE: i128 = 100;

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Rounding {
    Floor,
    Ceil,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PremiumComputation {
    pub total_premium: i128,
    pub config_version: u32,
}

/// Mirror of the policy-contract risk input, local to this crate.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PureInput {
    pub region: RegionTier,
    pub age_band: AgeBand,
    pub coverage: CoverageTier,
    pub safety_score: u32,
}

pub fn compute_premium(
    input: &PureInput,
    base_amount: i128,
    table: &MultiplierTable,
) -> Result<PremiumComputation, CalcError> {
    if base_amount <= 0 {
        return Err(CalcError::InvalidBaseAmount);
    }
    if input.safety_score > 100 {
        return Err(CalcError::SafetyScoreOutOfRange);
    }

    let region_m = table
        .region
        .get(input.region.clone())
        .ok_or(CalcError::MissingRegionMultiplier)?;
    let age_m = table
        .age
        .get(input.age_band.clone())
        .ok_or(CalcError::MissingAgeMultiplier)?;
    let coverage_m = table
        .coverage
        .get(input.coverage.clone())
        .ok_or(CalcError::MissingCoverageMultiplier)?;
    let safety_m = safety_multiplier(input.safety_score, table.safety_discount)?;

    let after_region = checked_mul_ratio(base_amount, region_m, SCALE, Rounding::Ceil)?;
    let after_age = checked_mul_ratio(after_region, age_m, SCALE, Rounding::Ceil)?;
    let after_coverage = checked_mul_ratio(after_age, coverage_m, SCALE, Rounding::Ceil)?;
    let after_safety = checked_mul_ratio(after_coverage, safety_m, SCALE, Rounding::Floor)?;
    let final_premium = round_to_multiple(after_safety, 1, Rounding::Ceil)?;

    Ok(PremiumComputation {
        total_premium: final_premium.max(1),
        config_version: table.version,
    })
}

fn safety_multiplier(safety_score: u32, max_discount: i128) -> Result<i128, CalcError> {
    let earned = checked_mul_ratio(
        safety_score as i128,
        max_discount,
        PERCENT_SCALE,
        Rounding::Floor,
    )?;
    checked_sub(SCALE, earned)
}

fn checked_mul(a: i128, b: i128) -> Result<i128, CalcError> {
    a.checked_mul(b).ok_or(CalcError::Overflow)
}

fn checked_add(a: i128, b: i128) -> Result<i128, CalcError> {
    a.checked_add(b).ok_or(CalcError::Overflow)
}

fn checked_sub(a: i128, b: i128) -> Result<i128, CalcError> {
    a.checked_sub(b).ok_or(CalcError::Overflow)
}

fn checked_div(a: i128, b: i128) -> Result<i128, CalcError> {
    if b == 0 {
        return Err(CalcError::DivideByZero);
    }
    Ok(a / b)
}

fn round_to_multiple(value: i128, multiple: i128, mode: Rounding) -> Result<i128, CalcError> {
    if multiple == 0 {
        return Err(CalcError::DivideByZero);
    }
    if value < 0 || multiple < 0 {
        return Err(CalcError::NegativePremiumNotSupported);
    }
    let quotient = checked_div(value, multiple)?;
    let rounded_down = checked_mul(quotient, multiple)?;
    let remainder = value % multiple;
    match mode {
        Rounding::Floor => Ok(rounded_down),
        Rounding::Ceil if remainder == 0 => Ok(rounded_down),
        Rounding::Ceil => checked_add(rounded_down, multiple),
    }
}

fn checked_mul_ratio(
    amount: i128,
    numerator: i128,
    denominator: i128,
    rounding: Rounding,
) -> Result<i128, CalcError> {
    if amount < 0 || numerator < 0 || denominator < 0 {
        return Err(CalcError::NegativePremiumNotSupported);
    }
    let product = checked_mul(amount, numerator)?;
    let quotient = checked_div(product, denominator)?;
    let remainder = product % denominator;
    match rounding {
        Rounding::Floor => Ok(quotient),
        Rounding::Ceil if remainder == 0 => Ok(quotient),
        Rounding::Ceil => checked_add(quotient, 1),
    }
}

/// Build a default table matching the policy contract defaults (for parity tests).
#[cfg(test)]
#[allow(dead_code)]
pub fn default_table_for_tests(env: &soroban_sdk::Env) -> MultiplierTable {
    crate::storage::default_table(env)
}
