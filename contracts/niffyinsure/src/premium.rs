//! Storage-backed premium orchestration.
//!
//! # Separation of concerns
//!
//! | Layer | File | Env? |
//! |-------|------|------|
//! | Pure math | `premium_pure.rs` | ❌ |
//! | Storage-backed orchestration | `premium.rs` (this file) | ✅ |
//!
//! All arithmetic is delegated to `premium_pure` so off-chain simulators can
//! reproduce the contract result bit-for-bit without a Soroban environment.

use crate::{
    premium_pure,
    storage,
    types::{
        AgeBand, CoverageTier, MultiplierTable, PremiumQuoteLineItem, PremiumTableUpdated,
        RegionTier, RiskInput,
    },
    validate::Error,
};
use soroban_sdk::{Env, Map, String, Vec};

// Re-export pure types and constants so existing callers don't need to change.
pub use premium_pure::{
    checked_add, checked_div, checked_mul, checked_mul_ratio, checked_sub,
    round_to_multiple, PremiumComputation, PremiumStep, Rounding,
    MAX_MULTIPLIER, MAX_SAFETY_DISCOUNT, MIN_MULTIPLIER, SCALE,
};

// ── Env-dependent functions ───────────────────────────────────────────────────

pub fn default_multiplier_table(env: &Env) -> MultiplierTable {
    let mut region = Map::new(env);
    region.set(RegionTier::Low, 8_500i128);
    region.set(RegionTier::Medium, 10_000i128);
    region.set(RegionTier::High, 13_500i128);

    let mut age = Map::new(env);
    age.set(AgeBand::Young, 12_500i128);
    age.set(AgeBand::Adult, 10_000i128);
    age.set(AgeBand::Senior, 11_500i128);

    let mut coverage = Map::new(env);
    coverage.set(CoverageTier::Basic, 9_000i128);
    coverage.set(CoverageTier::Standard, 10_000i128);
    coverage.set(CoverageTier::Premium, 13_000i128);

    MultiplierTable {
        region,
        age,
        coverage,
        safety_discount: 2_000,
        version: 1,
    }
}

pub fn update_multiplier_table(env: &Env, new_table: &MultiplierTable) -> Result<(), Error> {
    validate_multiplier_table(env, new_table)?;
    storage::set_multiplier_table(env, new_table);
    PremiumTableUpdated { version: new_table.version }.publish(env);
    Ok(())
}

/// Delegate to `premium_pure::compute_premium` — no Env required for the math.
pub fn compute_premium(
    input: &RiskInput,
    base_amount: i128,
    table: &MultiplierTable,
) -> Result<PremiumComputation, Error> {
    premium_pure::compute_premium(input, base_amount, table)
}

pub fn build_line_items(env: &Env, computation: &PremiumComputation) -> Vec<PremiumQuoteLineItem> {
    let mut items = Vec::new(env);
    for step in computation.steps.iter() {
        items.push_back(PremiumQuoteLineItem {
            component: String::from_str(env, step.component),
            factor: step.factor,
            amount: step.premium,
        });
    }
    items
}

// ── Multiplier table validation (Env-dependent) ───────────────────────────────

fn validate_multiplier_table(env: &Env, table: &MultiplierTable) -> Result<(), Error> {
    let current = storage::get_multiplier_table(env);
    if table.version <= current.version {
        return Err(Error::InvalidConfigVersion);
    }

    crate::validate::check_multiplier_table_shape(table)?;
    validate_table_rows(&table.region, MultiplierKind::Region)?;
    validate_table_rows(&table.age, MultiplierKind::Age)?;
    validate_table_rows(&table.coverage, MultiplierKind::Coverage)?;

    if table.safety_discount < 0 || table.safety_discount > MAX_SAFETY_DISCOUNT {
        return Err(Error::SafetyDiscountOutOfBounds);
    }

    Ok(())
}

fn validate_table_rows<T>(table: &Map<T, i128>, kind: MultiplierKind) -> Result<(), Error>
where
    T: Clone
        + soroban_sdk::TryFromVal<soroban_sdk::Env, soroban_sdk::Val>
        + soroban_sdk::IntoVal<soroban_sdk::Env, soroban_sdk::Val>,
{
    if table.len() != 3u32 {
        return Err(kind.missing_error());
    }
    for (_, value) in table.iter() {
        if !(MIN_MULTIPLIER..=MAX_MULTIPLIER).contains(&value) {
            return Err(kind.bounds_error());
        }
    }
    Ok(())
}

#[derive(Copy, Clone)]
enum MultiplierKind {
    Region,
    Age,
    Coverage,
}

impl MultiplierKind {
    fn missing_error(self) -> Error {
        match self {
            Self::Region => Error::MissingRegionMultiplier,
            Self::Age => Error::MissingAgeMultiplier,
            Self::Coverage => Error::MissingCoverageMultiplier,
        }
    }

    fn bounds_error(self) -> Error {
        match self {
            Self::Region => Error::RegionMultiplierOutOfBounds,
            Self::Age => Error::AgeMultiplierOutOfBounds,
            Self::Coverage => Error::CoverageMultiplierOutOfBounds,
        }
    }
}
