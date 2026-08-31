#![no_std]

mod errors;
mod storage;
pub mod types;

pub use errors::CalcError;
use soroban_sdk::{contract, contractevent, contractimpl, Address, Env};
use types::{
    CalcInput, CalcResult, MultiplierTable, MAX_MULTIPLIER, MAX_SAFETY_DISCOUNT, MIN_MULTIPLIER,
    SCALE,
};

/// Stable ABI identifier for cross-contract integrators (e.g. `niffyinsure`).
/// Bump only when `CalcInput` / `CalcResult` / entrypoint shape breaks compatibility.
pub const ABI_VERSION: u32 = 1;

#[contract]
pub struct PremiumCalculator;

#[contractevent(topics = ["premium_calculator", "config_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct ConfigUpdated {
    pub version: u32,
}

#[contractevent(topics = ["premium_calculator", "pause_toggled"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct PauseToggled {
    pub paused: bool,
}

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
    /// Returns `0` when the contract is not yet initialized (no panic).
    pub fn get_version(env: Env) -> u32 {
        match storage::get_table(&env) {
            Some(t) => t.version,
            None => 0,
        }
    }

    /// Stable ABI pin for integrators. Independent of multiplier-table `get_version`.
    /// Read-only: no storage access, no auth required.
    pub fn abi_version(_env: Env) -> u32 {
        ABI_VERSION
    }

    /// Returns the semver version string stamped at build time from `Cargo.toml`.
    /// Read-only: no storage access, no auth required. Safe to call via simulation.
    pub fn version(env: Env) -> soroban_sdk::String {
        soroban_sdk::String::from_str(&env, env!("CARGO_PKG_VERSION"))
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
        ConfigUpdated {
            version: new_table.version,
        }
        .publish(&env);
        Ok(())
    }

    /// Admin: pause/unpause the calculator (bind-fail-closed when paused).
    pub fn set_paused(env: Env, paused: bool) -> Result<(), CalcError> {
        let admin = storage::get_admin(&env).ok_or(CalcError::NotInitialized)?;
        admin.require_auth();
        storage::set_paused(&env, paused);
        PauseToggled { paused }.publish(&env);
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

    let r = table
        .region
        .get(input.region.clone())
        .ok_or(CalcError::MissingRegionMultiplier)?;
    let a = table
        .age
        .get(input.age_band.clone())
        .ok_or(CalcError::MissingAgeMultiplier)?;
    let c = table
        .coverage
        .get(input.coverage.clone())
        .ok_or(CalcError::MissingCoverageMultiplier)?;

    let earned = mul_ratio(input.safety_score as i128, table.safety_discount, 100)?;
    let safety = checked_sub(SCALE, earned)?;

    let v = mul_ratio(input.base_amount, r, SCALE)?;
    let v = mul_ratio(v, a, SCALE)?;
    let v = mul_ratio(v, c, SCALE)?;
    let v = mul_ratio(v, safety, SCALE)?;
    Ok(v.max(1))
}

fn validate_table(t: &MultiplierTable) -> Result<(), CalcError> {
    if t.region.len() != 3u32 {
        return Err(CalcError::MissingRegionMultiplier);
    }
    if t.age.len() != 3u32 {
        return Err(CalcError::MissingAgeMultiplier);
    }
    if t.coverage.len() != 3u32 {
        return Err(CalcError::MissingCoverageMultiplier);
    }

    for (_, v) in t.region.iter() {
        if !(MIN_MULTIPLIER..=MAX_MULTIPLIER).contains(&v) {
            return Err(CalcError::RegionMultiplierOutOfBounds);
        }
    }
    for (_, v) in t.age.iter() {
        if !(MIN_MULTIPLIER..=MAX_MULTIPLIER).contains(&v) {
            return Err(CalcError::AgeMultiplierOutOfBounds);
        }
    }
    for (_, v) in t.coverage.iter() {
        if !(MIN_MULTIPLIER..=MAX_MULTIPLIER).contains(&v) {
            return Err(CalcError::CoverageMultiplierOutOfBounds);
        }
    }
    if t.safety_discount < 0 || t.safety_discount > MAX_SAFETY_DISCOUNT {
        return Err(CalcError::SafetyDiscountOutOfBounds);
    }
    Ok(())
}

fn mul_ratio(amount: i128, num: i128, den: i128) -> Result<i128, CalcError> {
    if amount < 0 || num < 0 || den < 0 {
        return Err(CalcError::NegativePremiumNotSupported);
    }
    if den == 0 {
        return Err(CalcError::DivideByZero);
    }
    amount
        .checked_mul(num)
        .ok_or(CalcError::Overflow)
        .map(|p| p / den)
}

fn checked_sub(a: i128, b: i128) -> Result<i128, CalcError> {
    a.checked_sub(b).ok_or(CalcError::Overflow)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, Map};
    use types::{AgeBand, CoverageTier, RegionTier};

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(PremiumCalculator, ());
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, contract_id, admin)
    }

    fn sample_input(_env: &Env) -> CalcInput {
        CalcInput {
            region: RegionTier::Medium,
            age_band: AgeBand::Adult,
            coverage: CoverageTier::Standard,
            safety_score: 50,
            base_amount: 1_000_000,
        }
    }

    #[test]
    fn version_returns_nonempty_semver_string() {
        let env = Env::default();
        let contract_id = env.register(PremiumCalculator, ());
        let client = PremiumCalculatorClient::new(&env, &contract_id);

        let v = client.version();
        let expected = soroban_sdk::String::from_str(&env, env!("CARGO_PKG_VERSION"));
        assert_eq!(v, expected, "version() must match Cargo.toml");
    }

    #[test]
    fn version_requires_no_auth_and_no_init() {
        let env = Env::default();
        let contract_id = env.register(PremiumCalculator, ());
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        let _ = client.version();
    }

    #[test]
    fn version_is_idempotent() {
        let (env, contract_id, _) = setup();
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        let v1 = client.version();
        let v2 = client.version();
        assert_eq!(v1, v2);
    }

    #[test]
    fn abi_version_is_stable_constant() {
        let env = Env::default();
        let contract_id = env.register(PremiumCalculator, ());
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        assert_eq!(client.abi_version(), ABI_VERSION);
        assert_eq!(client.abi_version(), 1);
    }

    #[test]
    fn get_version_returns_zero_when_uninitialized_no_panic() {
        let env = Env::default();
        let contract_id = env.register(PremiumCalculator, ());
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        assert_eq!(client.get_version(), 0);
    }

    #[test]
    fn compute_not_initialized_returns_typed_error() {
        let env = Env::default();
        let contract_id = env.register(PremiumCalculator, ());
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        let err = client
            .try_compute(&sample_input(&env))
            .err()
            .unwrap()
            .unwrap();
        assert_eq!(err, CalcError::NotInitialized);
    }

    #[test]
    fn already_initialized_returns_typed_error() {
        let (env, contract_id, admin) = setup();
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        let err = client.try_initialize(&admin).err().unwrap().unwrap();
        assert_eq!(err, CalcError::AlreadyInitialized);
    }

    #[test]
    fn invalid_base_amount_returns_typed_error() {
        let (env, contract_id, _) = setup();
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        let mut input = sample_input(&env);
        input.base_amount = 0;
        let err = client.try_compute(&input).err().unwrap().unwrap();
        assert_eq!(err, CalcError::InvalidBaseAmount);
    }

    #[test]
    fn safety_score_out_of_range_returns_typed_error() {
        let (env, contract_id, _) = setup();
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        let mut input = sample_input(&env);
        input.safety_score = 101;
        let err = client.try_compute(&input).err().unwrap().unwrap();
        assert_eq!(err, CalcError::SafetyScoreOutOfRange);
    }

    #[test]
    fn paused_compute_returns_typed_error() {
        let (env, contract_id, _) = setup();
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        client.set_paused(&true);
        let err = client
            .try_compute(&sample_input(&env))
            .err()
            .unwrap()
            .unwrap();
        assert_eq!(err, CalcError::Paused);
    }

    #[test]
    fn update_table_invalid_config_version_returns_typed_error() {
        let (env, contract_id, _) = setup();
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        let mut table = storage::default_table(&env);
        table.version = 1;
        let err = client.try_update_table(&table).err().unwrap().unwrap();
        assert_eq!(err, CalcError::InvalidConfigVersion);
    }

    #[test]
    fn update_table_missing_region_returns_typed_error() {
        let (env, contract_id, _) = setup();
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        let mut table = storage::default_table(&env);
        table.version = 2;
        table.region = Map::new(&env);
        let err = client.try_update_table(&table).err().unwrap().unwrap();
        assert_eq!(err, CalcError::MissingRegionMultiplier);
    }

    #[test]
    fn update_table_region_out_of_bounds_returns_typed_error() {
        let (env, contract_id, _) = setup();
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        let mut table = storage::default_table(&env);
        table.version = 2;
        table.region.set(RegionTier::Low, MIN_MULTIPLIER - 1);
        let err = client.try_update_table(&table).err().unwrap().unwrap();
        assert_eq!(err, CalcError::RegionMultiplierOutOfBounds);
    }

    #[test]
    fn update_table_safety_discount_out_of_bounds_returns_typed_error() {
        let (env, contract_id, _) = setup();
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        let mut table = storage::default_table(&env);
        table.version = 2;
        table.safety_discount = MAX_SAFETY_DISCOUNT + 1;
        let err = client.try_update_table(&table).err().unwrap().unwrap();
        assert_eq!(err, CalcError::SafetyDiscountOutOfBounds);
    }

    #[test]
    fn compute_happy_path_returns_premium() {
        let (env, contract_id, _) = setup();
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        let result = client.compute(&sample_input(&env));
        assert!(result.premium > 0);
        assert_eq!(result.config_version, 1);
    }

    #[test]
    fn mul_ratio_divide_by_zero_returns_typed_error() {
        let err = mul_ratio(100, 1, 0).unwrap_err();
        assert_eq!(err, CalcError::DivideByZero);
    }

    #[test]
    fn mul_ratio_negative_returns_typed_error() {
        let err = mul_ratio(-1, 1, SCALE).unwrap_err();
        assert_eq!(err, CalcError::NegativePremiumNotSupported);
    }

    #[test]
    fn mul_ratio_overflow_returns_typed_error() {
        let err = mul_ratio(i128::MAX, 2, 1).unwrap_err();
        assert_eq!(err, CalcError::Overflow);
    }
}
