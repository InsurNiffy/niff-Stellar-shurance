//! Pure premium calculation functions — no `Env` dependency.
//!
//! # Sharing with `niffyinsure` (issue #1428)
//!
//! The authoritative staged formula and golden vectors live in
//! `contracts/niffyinsure/src/premium_pure.rs` and
//! `contracts/niffyinsure/testdata/golden-vectors.json`.
//!
//! **Choice:** do not duplicate that module here. This calculator contract keeps
//! a thin on-chain `compute` entrypoint for cross-contract quotes; numerical
//! parity with niffyinsure is enforced by the golden-vector suite. A shared
//! crate was considered but deferred because error enums differ and both crates
//! already ship independently deployable WASMs. Prefer `#[path]` / workspace
//! extraction if a third consumer appears.
#![no_std]

mod errors;
mod premium_pure;
mod storage;
pub mod types;

pub use errors::CalcError;
pub use premium_pure::{compute_premium as pure_compute_premium, PureInput};
use soroban_sdk::{contract, contractevent, contractimpl, Address, Env};
use types::{CalcInput, CalcResult, MultiplierTable, MAX_MULTIPLIER, MAX_SAFETY_DISCOUNT, MIN_MULTIPLIER};

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
    /// Delegates arithmetic to the shared pure engine (`premium_pure`).
    pub fn compute(env: Env, input: CalcInput) -> Result<CalcResult, CalcError> {
        if storage::is_paused(&env) {
            return Err(CalcError::Paused);
        }
        let table = storage::get_table(&env).ok_or(CalcError::NotInitialized)?;
        let pure_input = PureInput {
            region: input.region,
            age_band: input.age_band,
            coverage: input.coverage,
            safety_score: input.safety_score,
        };
        let computation = premium_pure::compute_premium(&pure_input, input.base_amount, &table)?;
        Ok(CalcResult {
            premium: computation.total_premium,
            config_version: computation.config_version,
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

    /// Admin: pause/unpause the calculator.
    pub fn set_paused(env: Env, paused: bool) -> Result<(), CalcError> {
        let admin = storage::get_admin(&env).ok_or(CalcError::NotInitialized)?;
        admin.require_auth();
        storage::set_paused(&env, paused);
        PauseToggled { paused }.publish(&env);
        Ok(())
    }
}

/// Validate every row before persisting a multiplier table.
pub fn validate_table(t: &MultiplierTable) -> Result<(), CalcError> {
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
    fn get_version_zero_before_init() {
        let env = Env::default();
        let contract_id = env.register(PremiumCalculator, ());
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        assert_eq!(client.get_version(), 0);
    }

    #[test]
    fn initialize_seeds_default_table() {
        let (env, contract_id, _) = setup();
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        assert!(client.get_version() >= 1);
    }

    #[test]
    fn initialize_twice_fails() {
        let (env, contract_id, admin) = setup();
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        assert_eq!(
            client.try_initialize(&admin),
            Err(Ok(CalcError::AlreadyInitialized))
        );
    }

    #[test]
    fn compute_before_init_fails() {
        let env = Env::default();
        let contract_id = env.register(PremiumCalculator, ());
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        assert_eq!(
            client.try_compute(&sample_input(&env)),
            Err(Ok(CalcError::NotInitialized))
        );
    }

    #[test]
    fn compute_returns_result_after_init() {
        let (env, contract_id, _) = setup();
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        let result = client.compute(&sample_input(&env));
        assert!(result.premium > 0);
        assert_eq!(result.config_version, client.get_version());
    }

    #[test]
    fn paused_calculator_rejects_compute() {
        let (env, contract_id, _) = setup();
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        client.set_paused(&true);
        assert_eq!(
            client.try_compute(&sample_input(&env)),
            Err(Ok(CalcError::Paused))
        );
        client.set_paused(&false);
        assert!(client.compute(&sample_input(&env)).premium > 0);
    }

    #[test]
    fn update_table_rejects_non_increasing_version() {
        let (env, contract_id, _) = setup();
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        let current = client.get_version();
        let mut table = storage::default_table(&env);
        table.version = current;
        assert_eq!(
            client.try_update_table(&table),
            Err(Ok(CalcError::InvalidConfigVersion))
        );
    }

    #[test]
    fn update_table_validates_rows() {
        let (env, contract_id, _) = setup();
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        let current = client.get_version();
        let mut table = storage::default_table(&env);
        table.version = current + 1;
        let mut bad_region: Map<RegionTier, i128> = Map::new(&env);
        bad_region.set(RegionTier::Low, MAX_MULTIPLIER + 1);
        table.region = bad_region;
        assert_eq!(
            client.try_update_table(&table),
            Err(Ok(CalcError::MissingRegionMultiplier))
        );
    }

    #[test]
    fn update_table_accepts_valid_increment() {
        let (env, contract_id, _) = setup();
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        let current = client.get_version();
        let mut table = storage::default_table(&env);
        table.version = current + 1;
        client.update_table(&table);
        assert_eq!(client.get_version(), current + 1);
    }

    #[test]
    fn compute_matches_pure_engine_golden_vectors() {
        let (env, contract_id, _) = setup();
        let client = PremiumCalculatorClient::new(&env, &contract_id);
        let table = storage::get_table(&env).unwrap();

        let regions = [RegionTier::Low, RegionTier::Medium, RegionTier::High];
        let ages = [AgeBand::Young, AgeBand::Adult, AgeBand::Senior];
        let coverages = [
            CoverageTier::Basic,
            CoverageTier::Standard,
            CoverageTier::Premium,
        ];
        let safety_scores = [0u32, 50, 100];
        let base_amounts = [1_000_000i128, 5_000_000, 25_000_000];

        for region in regions.iter() {
            for age_band in ages.iter() {
                for coverage in coverages.iter() {
                    for safety_score in safety_scores.iter() {
                        for base_amount in base_amounts.iter() {
                            let input = CalcInput {
                                region: region.clone(),
                                age_band: age_band.clone(),
                                coverage: coverage.clone(),
                                safety_score: *safety_score,
                                base_amount: *base_amount,
                            };
                            let on_chain = client.compute(&input);
                            let pure_input = PureInput {
                                region: region.clone(),
                                age_band: age_band.clone(),
                                coverage: coverage.clone(),
                                safety_score: *safety_score,
                            };
                            let pure = premium_pure::compute_premium(
                                &pure_input,
                                *base_amount,
                                &table,
                            )
                            .unwrap();
                            assert_eq!(on_chain.premium, pure.total_premium);
                            assert_eq!(on_chain.config_version, pure.config_version);
                        }
                    }
                }
            }
        }
    }
}
