//! Pure premium calculation functions — no `Env` dependency.
//!
//! # Separation of concerns
//!
//! | Layer | File | Env? |
//! |-------|------|------|
//! | Pure math | `premium_pure.rs` (this file) | ❌ |
//! | Storage-backed orchestration | `premium.rs` | ✅ |
//!
//! All arithmetic lives here so off-chain simulators and unit tests can
//! reproduce the contract result bit-for-bit without a Soroban environment.

use crate::{
    types::{AgeBand, CoverageTier, MultiplierTable, RegionTier, RiskInput},
    validate::Error,
};

// ── Constants ─────────────────────────────────────────────────────────────────

pub const SCALE: i128 = 10_000;
pub const MIN_MULTIPLIER: i128 = 5_000;
pub const MAX_MULTIPLIER: i128 = 50_000;
pub const MAX_SAFETY_DISCOUNT: i128 = 5_000;
const PERCENT_SCALE: i128 = 100;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Rounding {
    Floor,
    Ceil,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PremiumStep {
    pub component: &'static str,
    pub factor: i128,
    pub premium: i128,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PremiumComputation {
    pub total_premium: i128,
    pub config_version: u32,
    pub steps: [PremiumStep; 5],
}

// ── Core computation ──────────────────────────────────────────────────────────

/// Compute the full premium for `input` against `table`.
///
/// Stages (each rounds explicitly for off-chain reproducibility):
/// 1. Base × region risk  → `after_region`
/// 2. × age-band risk     → `after_age`
/// 3. × coverage level    → `after_coverage`
/// 4. × safety discount   → `after_safety`
/// 5. Round up to token unit → `final_premium`
pub fn compute_premium(
    input: &RiskInput,
    base_amount: i128,
    table: &MultiplierTable,
) -> Result<PremiumComputation, Error> {
    if base_amount <= 0 {
        return Err(Error::InvalidBaseAmount);
    }

    let region_m = region_multiplier(table, &input.region)?;
    let age_m = age_multiplier(table, &input.age_band)?;
    let coverage_m = coverage_multiplier(table, &input.coverage)?;
    let safety_m = safety_multiplier(input.safety_score, table.safety_discount)?;

    let after_region = checked_mul_ratio(base_amount, region_m, SCALE, Rounding::Ceil)?;
    let after_age = checked_mul_ratio(after_region, age_m, SCALE, Rounding::Ceil)?;
    let after_coverage = checked_mul_ratio(after_age, coverage_m, SCALE, Rounding::Ceil)?;
    let after_safety = checked_mul_ratio(after_coverage, safety_m, SCALE, Rounding::Floor)?;
    let final_premium = round_to_multiple(after_safety, 1, Rounding::Ceil)?;

    Ok(PremiumComputation {
        total_premium: final_premium,
        config_version: table.version,
        steps: [
            PremiumStep { component: "region",           factor: region_m,   premium: after_region   },
            PremiumStep { component: "age_band",         factor: age_m,      premium: after_age      },
            PremiumStep { component: "coverage",         factor: coverage_m, premium: after_coverage  },
            PremiumStep { component: "safety_multiplier",factor: safety_m,   premium: after_safety   },
            PremiumStep { component: "final_rounding",   factor: 1,          premium: final_premium  },
        ],
    })
}

// ── Multiplier helpers ────────────────────────────────────────────────────────

pub fn region_multiplier(table: &MultiplierTable, tier: &RegionTier) -> Result<i128, Error> {
    table.region.get(tier.clone()).ok_or(Error::MissingRegionMultiplier)
}

pub fn age_multiplier(table: &MultiplierTable, band: &AgeBand) -> Result<i128, Error> {
    table.age.get(band.clone()).ok_or(Error::MissingAgeMultiplier)
}

pub fn coverage_multiplier(table: &MultiplierTable, level: &CoverageTier) -> Result<i128, Error> {
    table.coverage.get(level.clone()).ok_or(Error::MissingCoverageMultiplier)
}

/// Safety multiplier: `SCALE - floor(score * max_discount / 100)`.
pub fn safety_multiplier(safety_score: u32, max_discount: i128) -> Result<i128, Error> {
    let score = safety_score as i128;
    let earned = checked_mul_ratio(score, max_discount, PERCENT_SCALE, Rounding::Floor)?;
    checked_sub(SCALE, earned)
}

// ── Arithmetic primitives ─────────────────────────────────────────────────────

pub fn checked_mul(a: i128, b: i128) -> Result<i128, Error> {
    a.checked_mul(b).ok_or(Error::Overflow)
}

pub fn checked_add(a: i128, b: i128) -> Result<i128, Error> {
    a.checked_add(b).ok_or(Error::Overflow)
}

pub fn checked_sub(a: i128, b: i128) -> Result<i128, Error> {
    a.checked_sub(b).ok_or(Error::Overflow)
}

pub fn checked_div(a: i128, b: i128) -> Result<i128, Error> {
    if b == 0 {
        return Err(Error::DivideByZero);
    }
    Ok(a / b)
}

pub fn round_to_multiple(value: i128, multiple: i128, mode: Rounding) -> Result<i128, Error> {
    if multiple == 0 {
        return Err(Error::DivideByZero);
    }
    if value < 0 || multiple < 0 {
        return Err(Error::NegativePremiumNotSupported);
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

pub fn checked_mul_ratio(
    amount: i128,
    numerator: i128,
    denominator: i128,
    rounding: Rounding,
) -> Result<i128, Error> {
    if amount < 0 || numerator < 0 || denominator < 0 {
        return Err(Error::NegativePremiumNotSupported);
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

// ── Unit tests (no Soroban Env required) ─────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Arithmetic ────────────────────────────────────────────────────────────

    #[test]
    fn checked_mul_ratio_floor_truncates() {
        // 10 * 3 / 4 = 7.5 → floor → 7
        assert_eq!(checked_mul_ratio(10, 3, 4, Rounding::Floor).unwrap(), 7);
    }

    #[test]
    fn checked_mul_ratio_ceil_rounds_up() {
        // 10 * 3 / 4 = 7.5 → ceil → 8
        assert_eq!(checked_mul_ratio(10, 3, 4, Rounding::Ceil).unwrap(), 8);
    }

    #[test]
    fn checked_mul_ratio_exact_no_rounding() {
        // 10 * 2 / 4 = 5.0 → both modes → 5
        assert_eq!(checked_mul_ratio(10, 2, 4, Rounding::Floor).unwrap(), 5);
        assert_eq!(checked_mul_ratio(10, 2, 4, Rounding::Ceil).unwrap(), 5);
    }

    #[test]
    fn checked_mul_ratio_rejects_negative() {
        assert_eq!(checked_mul_ratio(-1, 1, 1, Rounding::Floor), Err(Error::NegativePremiumNotSupported));
        assert_eq!(checked_mul_ratio(1, -1, 1, Rounding::Floor), Err(Error::NegativePremiumNotSupported));
        assert_eq!(checked_mul_ratio(1, 1, -1, Rounding::Floor), Err(Error::NegativePremiumNotSupported));
    }

    #[test]
    fn checked_div_by_zero() {
        assert_eq!(checked_div(1, 0), Err(Error::DivideByZero));
    }

    #[test]
    fn round_to_multiple_floor() {
        assert_eq!(round_to_multiple(7, 5, Rounding::Floor).unwrap(), 5);
        assert_eq!(round_to_multiple(10, 5, Rounding::Floor).unwrap(), 10);
    }

    #[test]
    fn round_to_multiple_ceil() {
        assert_eq!(round_to_multiple(7, 5, Rounding::Ceil).unwrap(), 10);
        assert_eq!(round_to_multiple(10, 5, Rounding::Ceil).unwrap(), 10);
    }

    #[test]
    fn round_to_multiple_zero_multiple_errors() {
        assert_eq!(round_to_multiple(5, 0, Rounding::Floor), Err(Error::DivideByZero));
    }

    // ── Safety multiplier ─────────────────────────────────────────────────────

    #[test]
    fn safety_multiplier_zero_score_no_discount() {
        // score=0 → earned=0 → multiplier = SCALE
        assert_eq!(safety_multiplier(0, 2_000).unwrap(), SCALE);
    }

    #[test]
    fn safety_multiplier_max_score_full_discount() {
        // score=100, max_discount=2_000 → earned=2_000 → multiplier = 8_000
        assert_eq!(safety_multiplier(100, 2_000).unwrap(), 8_000);
    }

    #[test]
    fn safety_multiplier_partial_score() {
        // score=50, max_discount=2_000 → earned=1_000 → multiplier = 9_000
        assert_eq!(safety_multiplier(50, 2_000).unwrap(), 9_000);
    }

    // ── compute_premium ───────────────────────────────────────────────────────

    fn make_table() -> MultiplierTable {
        use soroban_sdk::{Env, Map};
        let env = Env::default();
        let mut region = Map::new(&env);
        region.set(RegionTier::Low, 8_500i128);
        region.set(RegionTier::Medium, 10_000i128);
        region.set(RegionTier::High, 13_500i128);

        let mut age = Map::new(&env);
        age.set(AgeBand::Young, 12_500i128);
        age.set(AgeBand::Adult, 10_000i128);
        age.set(AgeBand::Senior, 11_500i128);

        let mut coverage = Map::new(&env);
        coverage.set(CoverageTier::Basic, 9_000i128);
        coverage.set(CoverageTier::Standard, 10_000i128);
        coverage.set(CoverageTier::Premium, 13_000i128);

        MultiplierTable { region, age, coverage, safety_discount: 2_000, version: 1 }
    }

    #[test]
    fn compute_premium_rejects_zero_base() {
        let table = make_table();
        let input = RiskInput {
            region: RegionTier::Medium,
            age_band: AgeBand::Adult,
            coverage: CoverageTier::Standard,
            safety_score: 0,
        };
        assert_eq!(compute_premium(&input, 0, &table), Err(Error::InvalidBaseAmount));
    }

    #[test]
    fn compute_premium_baseline_medium_adult_standard_no_safety() {
        // base=10_000, region=1.0, age=1.0, coverage=1.0, safety=0 → 10_000
        let table = make_table();
        let input = RiskInput {
            region: RegionTier::Medium,
            age_band: AgeBand::Adult,
            coverage: CoverageTier::Standard,
            safety_score: 0,
        };
        let result = compute_premium(&input, 10_000, &table).unwrap();
        assert_eq!(result.total_premium, 10_000);
        assert_eq!(result.config_version, 1);
        assert_eq!(result.steps.len(), 5);
    }

    #[test]
    fn compute_premium_high_risk_increases_premium() {
        let table = make_table();
        let low_risk = RiskInput {
            region: RegionTier::Low,
            age_band: AgeBand::Adult,
            coverage: CoverageTier::Basic,
            safety_score: 100,
        };
        let high_risk = RiskInput {
            region: RegionTier::High,
            age_band: AgeBand::Senior,
            coverage: CoverageTier::Premium,
            safety_score: 0,
        };
        let low = compute_premium(&low_risk, 10_000, &table).unwrap().total_premium;
        let high = compute_premium(&high_risk, 10_000, &table).unwrap().total_premium;
        assert!(high > low, "high risk should cost more: high={high}, low={low}");
    }

    #[test]
    fn compute_premium_steps_are_monotonically_labelled() {
        let table = make_table();
        let input = RiskInput {
            region: RegionTier::Medium,
            age_band: AgeBand::Adult,
            coverage: CoverageTier::Standard,
            safety_score: 50,
        };
        let result = compute_premium(&input, 10_000, &table).unwrap();
        assert_eq!(result.steps[0].component, "region");
        assert_eq!(result.steps[1].component, "age_band");
        assert_eq!(result.steps[2].component, "coverage");
        assert_eq!(result.steps[3].component, "safety_multiplier");
        assert_eq!(result.steps[4].component, "final_rounding");
    }

    #[test]
    fn compute_premium_missing_region_errors() {
        // Build a table with only Medium/High region entries (missing Low)
        use soroban_sdk::{Env, Map};
        let env = Env::default();
        let mut region = Map::new(&env);
        region.set(RegionTier::Medium, 10_000i128);
        region.set(RegionTier::High, 13_500i128);
        // Intentionally omit Low

        let mut age = Map::new(&env);
        age.set(AgeBand::Young, 12_500i128);
        age.set(AgeBand::Adult, 10_000i128);
        age.set(AgeBand::Senior, 11_500i128);

        let mut coverage = Map::new(&env);
        coverage.set(CoverageTier::Basic, 9_000i128);
        coverage.set(CoverageTier::Standard, 10_000i128);
        coverage.set(CoverageTier::Premium, 13_000i128);

        let table = MultiplierTable { region, age, coverage, safety_discount: 2_000, version: 1 };
        let input = RiskInput {
            region: RegionTier::Low,
            age_band: AgeBand::Adult,
            coverage: CoverageTier::Standard,
            safety_score: 0,
        };
        assert_eq!(compute_premium(&input, 10_000, &table), Err(Error::MissingRegionMultiplier));
    }
}
