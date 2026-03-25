use soroban_sdk::{contracttype, Map};

pub const SCALE: i128 = 10_000;
pub const MIN_MULTIPLIER: i128 = 5_000;
pub const MAX_MULTIPLIER: i128 = 50_000;
pub const MAX_SAFETY_DISCOUNT: i128 = 5_000;

/// Geographic risk tier.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum RegionTier {
    Low,
    Medium,
    High,
}

/// Underwriting age bucket.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum AgeBand {
    Young,
    Adult,
    Senior,
}

/// Coverage level.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum CoverageType {
    Basic,
    Standard,
    Premium,
}

/// Structured risk input for premium computation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CalcInput {
    pub region: RegionTier,
    pub age_band: AgeBand,
    pub coverage: CoverageType,
    /// 0..=100; percentage of max safety discount earned.
    pub safety_score: u32,
    pub base_amount: i128,
}

/// Result returned by `compute`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CalcResult {
    pub premium: i128,
    pub config_version: u32,
}

/// Admin-configurable multiplier table (same semantics as policy contract).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultiplierTable {
    pub region: Map<RegionTier, i128>,
    pub age: Map<AgeBand, i128>,
    pub coverage: Map<CoverageType, i128>,
    pub safety_discount: i128,
    pub version: u32,
}
