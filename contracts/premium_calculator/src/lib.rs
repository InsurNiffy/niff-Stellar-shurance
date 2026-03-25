#![no_std]

mod errors;
mod storage;
pub mod types;

pub use errors::CalcError;
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};
use types::{CalcInput, CalcResult, MultiplierTable, SCALE, MAX_SAFETY_DISCOUNT, MIN_MULTIPLIER, MAX_MULTIPLIER};

#[contract]
pub struct PremiumCalculator;

#[contractimpl]
impl PremiumCalculator {
    /// One-time init: store admin and seed default multiplier table.
    pub fn initialize(env: Env, admin: Address) -> Result<(), CalcError> {
        if storage::get_admin(&env).is_some() {
            return Err(CalcError::AlreadyInitialized);
        }
        storage::set_admin(&env, &admin);
        storage::set_table(&env, &storage::default_table(&env));
        Ok(())
    }

    /// Core pricing entrypoint — called cross-contract by the policy contract.
    pub fn compute(env: Env, input: CalcInput) -> Result<CalcResult, CalcError> {
        if storage::is_paused(&env) {
            return Err(CalcError::Paused);
        }
        let table = storage::get_table(&env).ok_or(CalcError::NotInitialized)?;
        let premium = compute_premium(&input, &table)?;
        Ok(CalcResult {
            premium,
            config_version: table.version,
        })
    }

    /// Returns the current multiplier table version (capability flag).
    pub fn get_version(env: Env) -> u32 {
        storage::get_table(&env).map(|t| t.version).unwrap_or(0)
    }

    /// Admin: replace the multiplier table. Version must be strictly greater.
    pub fn update_table(env: Env, new_table: MultiplierTable) -> Result<(), CalcError> {
        let admin = storage::get_admin(&env).ok_or(CalcError::NotInitialized)?;
        admin.require_auth();
        let current = storage::get_table(&env).ok_or(CalcError::NotInitialized)?;
        if new_table.version <= current.version {
            return Err(CalcError::InvalidConfigVersion);
        }
        validate_table(&new_table)?;
        storage::set_table(&env, &new_table);
        env.events().publish(
            (symbol_short!("cfg"),),
            new_table.version,
        );
        Ok(())
    }

    /// Admin: pause/unpause the calculator (bind-fail-closed when paused).
    pub fn set_paused(env: Env, paused: bool) -> Result<(), CalcError> {
        let admin = storage::get_admin(&env).ok_or(CalcError::NotInitialized)?;
        admin.require_auth();
        storage::set_paused(&env, paused);
        env.events().publish(
            (symbol_short!("pause"),),
            paused,
        );
        Ok(())
    }
}

// ── Internal math ─────────────────────────────────────────────────────────────

fn compute_premium(input: &CalcInput, table: &MultiplierTable) -> Result<i128, CalcError> {
    if input.base_amount <= 0 {
        return Err(CalcError::InvalidBaseAmount);
    }
    if input.safety_score > 100 {
        return Err(CalcError::SafetyScoreOutOfRange);
    }

    let r = table.region.get(input.region.clone()).ok_or(CalcError::MissingRegionMultiplier)?;
    let a = table.age.get(input.age_band.clone()).ok_or(CalcError::MissingAgeMultiplier)?;
    let c = table.coverage.get(input.coverage.clone()).ok_or(CalcError::MissingCoverageMultiplier)?;

    let earned = mul_ratio(input.safety_score as i128, table.safety_discount, 100)?;
    let safety = checked_sub(SCALE, earned)?;

    let v = mul_ratio(input.base_amount, r, SCALE)?;
    let v = mul_ratio(v, a, SCALE)?;
    let v = mul_ratio(v, c, SCALE)?;
    let v = mul_ratio(v, safety, SCALE)?;
    Ok(v.max(1))
}

fn validate_table(t: &MultiplierTable) -> Result<(), CalcError> {
    if t.region.len() != 3u32 { return Err(CalcError::MissingRegionMultiplier); }
    if t.age.len() != 3u32 { return Err(CalcError::MissingAgeMultiplier); }
    if t.coverage.len() != 3u32 { return Err(CalcError::MissingCoverageMultiplier); }

    for (_, v) in t.region.iter() {
        if v < MIN_MULTIPLIER || v > MAX_MULTIPLIER { return Err(CalcError::RegionMultiplierOutOfBounds); }
    }
    for (_, v) in t.age.iter() {
        if v < MIN_MULTIPLIER || v > MAX_MULTIPLIER { return Err(CalcError::AgeMultiplierOutOfBounds); }
    }
    for (_, v) in t.coverage.iter() {
        if v < MIN_MULTIPLIER || v > MAX_MULTIPLIER { return Err(CalcError::CoverageMultiplierOutOfBounds); }
    }
    if t.safety_discount < 0 || t.safety_discount > MAX_SAFETY_DISCOUNT {
        return Err(CalcError::SafetyDiscountOutOfBounds);
    }
    Ok(())
}

fn mul_ratio(amount: i128, num: i128, den: i128) -> Result<i128, CalcError> {
    if amount < 0 || num < 0 || den < 0 { return Err(CalcError::NegativePremiumNotSupported); }
    if den == 0 { return Err(CalcError::DivideByZero); }
    amount.checked_mul(num).ok_or(CalcError::Overflow).map(|p| p / den)
}

fn checked_sub(a: i128, b: i128) -> Result<i128, CalcError> {
    a.checked_sub(b).ok_or(CalcError::Overflow)
}
