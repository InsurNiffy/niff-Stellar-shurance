use crate::{
    storage,
    types::{
        AgeBand, CoverageType, MultiplierTable, PremiumQuoteLineItem, PremiumTableUpdated,
        RegionTier, RiskInput,
    },
    validate::Error,
};
use soroban_sdk::{symbol_short, Env, Map, String, Vec};

pub const SCALE: i128 = 10_000;
pub const MIN_MULTIPLIER: i128 = 5_000;
pub const MAX_MULTIPLIER: i128 = 50_000;
pub const MAX_SAFETY_DISCOUNT: i128 = 5_000;
const PERCENT_SCALE: i128 = 100;

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

pub fn default_multiplier_table(env: &Env) -> MultiplierTable {
    let mut region = Map::new(env);
    region.set(RegionTier::Low, 8_500);
    region.set(RegionTier::Medium, 10_000);
    region.set(RegionTier::High, 13_500);

    let mut age = Map::new(env);
    age.set(AgeBand::Young, 12_500);
    age.set(AgeBand::Adult, 10_000);
    age.set(AgeBand::Senior, 11_500);

    let mut coverage = Map::new(env);
    coverage.set(CoverageType::Basic, 9_000);
    coverage.set(CoverageType::Standard, 10_000);
    coverage.set(CoverageType::Premium, 13_000);

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
    env.events().publish(
        (symbol_short!("prm_cfg"),),
        PremiumTableUpdated {
            version: new_table.version,
        },
    );
    Ok(())
}

pub fn compute_premium(
    input: &RiskInput,
    base_amount: i128,
    table: &MultiplierTable,
) -> Result<PremiumComputation, Error> {
    if base_amount <= 0 {
        return Err(Error::InvalidBaseAmount);
    }

    let region_multiplier = region_multiplier(table, &input.region)?;
    let age_multiplier = age_multiplier(table, &input.age_band)?;
    let coverage_multiplier = coverage_multiplier(table, &input.coverage)?;
    let safety_multiplier = safety_multiplier(input.safety_score, table.safety_discount)?;

    // Order of operations:
    // 1. Base premium scaled by region risk.
    // 2. Region-adjusted premium scaled by age-band risk.
    // 3. Age-adjusted premium scaled by coverage level.
    // 4. Post-risk premium discounted by the safety score.
    // 5. Final premium rounded up to the token's smallest unit.
    //
    // Each stage rounds explicitly so actuarial spreadsheets and off-chain
    // previews can reproduce the contract result bit-for-bit.
    let after_region = checked_mul_ratio(base_amount, region_multiplier, SCALE, Rounding::Ceil)?;
    let after_age = checked_mul_ratio(after_region, age_multiplier, SCALE, Rounding::Ceil)?;
    let after_coverage =
        checked_mul_ratio(after_age, coverage_multiplier, SCALE, Rounding::Ceil)?;
    let after_safety =
        checked_mul_ratio(after_coverage, safety_multiplier, SCALE, Rounding::Floor)?;
    let final_premium = round_to_multiple(after_safety, 1, Rounding::Ceil)?;

    Ok(PremiumComputation {
        total_premium: final_premium,
        config_version: table.version,
        steps: [
            PremiumStep {
                component: "region",
                factor: region_multiplier,
                premium: after_region,
            },
            PremiumStep {
                component: "age_band",
                factor: age_multiplier,
                premium: after_age,
            },
            PremiumStep {
                component: "coverage",
                factor: coverage_multiplier,
                premium: after_coverage,
            },
            PremiumStep {
                component: "safety_multiplier",
                factor: safety_multiplier,
                premium: after_safety,
            },
            PremiumStep {
                component: "final_rounding",
                factor: 1,
                premium: final_premium,
            },
        ],
    })
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
    T: Clone + soroban_sdk::TryFromVal<soroban_sdk::Env, soroban_sdk::Val> + soroban_sdk::IntoVal<soroban_sdk::Env, soroban_sdk::Val>,
{
    if table.len() != 3u32 {
        return Err(kind.missing_error());
    }

    for (_, value) in table.iter() {
        if value < MIN_MULTIPLIER || value > MAX_MULTIPLIER {
            return Err(kind.bounds_error());
        }
    }

    Ok(())
}

fn region_multiplier(table: &MultiplierTable, tier: &RegionTier) -> Result<i128, Error> {
    table
        .region
        .get(tier.clone())
        .ok_or(Error::MissingRegionMultiplier)
}

fn age_multiplier(table: &MultiplierTable, band: &AgeBand) -> Result<i128, Error> {
    table.age.get(band.clone()).ok_or(Error::MissingAgeMultiplier)
}

fn coverage_multiplier(table: &MultiplierTable, level: &CoverageType) -> Result<i128, Error> {
    table
        .coverage
        .get(level.clone())
        .ok_or(Error::MissingCoverageMultiplier)
}

fn safety_multiplier(safety_score: u32, max_discount: i128) -> Result<i128, Error> {
    let score = safety_score as i128;
    let earned_discount =
        checked_mul_ratio(score, max_discount, PERCENT_SCALE, Rounding::Floor)?;
    checked_sub(SCALE, earned_discount)
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

#[allow(dead_code)]
pub fn type_factor(policy_type: &PolicyType) -> i128 {
    match policy_type {
        PolicyType::Auto => 15,
        PolicyType::Health => 20,
        PolicyType::Property => 10,
    }
}

#[allow(dead_code)]
pub fn region_factor(region: &RegionTier) -> i128 {
    match region {
        RegionTier::Low => 8,
        RegionTier::Medium => 10,
        RegionTier::High => 14,
    }
}

#[allow(dead_code)]
pub fn age_factor(age: u32) -> i128 {
    if age < 25 {
        15
    } else if age > 60 {
        13
    } else {
        10
    }
}

pub fn compute_premium_checked(
    policy_type: &PolicyType,
    region: &RegionTier,
    age: u32,
    risk_score: u32,
) -> Option<i128> {
    let tf = type_factor(policy_type);
    let rf = region_factor(region);
    let af = age_factor(age);
    let raw = tf
        .checked_add(rf)?
        .checked_add(af)?
        .checked_add(risk_score as i128)?;
    BASE.checked_mul(raw)?.checked_div(10)
}

pub fn build_line_items(
    env: &Env,
    policy_type: &PolicyType,
    region: &RegionTier,
    age: u32,
    risk_score: u32,
) -> Option<Vec<PremiumQuoteLineItem>> {
    let tf = type_factor(policy_type);
    let rf = region_factor(region);
    let af = age_factor(age);
    let rsk = risk_score as i128;

    let base_type = BASE.checked_mul(tf)?.checked_div(10)?;
    let base_region = BASE.checked_mul(rf)?.checked_div(10)?;
    let base_age = BASE.checked_mul(af)?.checked_div(10)?;
    let base_risk = BASE.checked_mul(rsk)?.checked_div(10)?;

    let mut items = Vec::new(env);
    items.push_back(PremiumQuoteLineItem {
        component: String::from_str(env, "type"),
        factor: tf,
        amount: base_type,
    });
    items.push_back(PremiumQuoteLineItem {
        component: String::from_str(env, "region"),
        factor: rf,
        amount: base_region,
    });
    items.push_back(PremiumQuoteLineItem {
        component: String::from_str(env, "age"),
        factor: af,
        amount: base_age,
    });
    items.push_back(PremiumQuoteLineItem {
        component: String::from_str(env, "risk_score"),
        factor: rsk,
        amount: base_risk,
    });
    Some(items)
}
