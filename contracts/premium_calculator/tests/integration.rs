//! Standalone integration tests for the `premium_calculator` contract.
//!
//! These tests deploy and call the calculator directly — they do **not** go
//! through the `niffyinsure` policy contract.

#![cfg(test)]

use premium_calculator::{
    types::{AgeBand, CalcInput, CoverageTier, MultiplierTable, RegionTier, SCALE},
    CalcError, PremiumCalculator, PremiumCalculatorClient,
};
use soroban_sdk::{map, testutils::Address as _, Address, Env};

fn setup() -> (Env, PremiumCalculatorClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PremiumCalculator, ());
    let client = PremiumCalculatorClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
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

fn valid_table(env: &Env, version: u32) -> MultiplierTable {
    MultiplierTable {
        region: map![
            env,
            (RegionTier::Low, 8_500i128),
            (RegionTier::Medium, 10_000i128),
            (RegionTier::High, 13_500i128)
        ],
        age: map![
            env,
            (AgeBand::Young, 12_500i128),
            (AgeBand::Adult, 10_000i128),
            (AgeBand::Senior, 11_500i128)
        ],
        coverage: map![
            env,
            (CoverageTier::Basic, 9_000i128),
            (CoverageTier::Standard, 10_000i128),
            (CoverageTier::Premium, 13_000i128)
        ],
        safety_discount: 2_000,
        version,
    }
}

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn initialize_happy_path_sets_version_one() {
    let (_env, client, _admin) = setup();
    assert_eq!(client.get_version(), 1u32);
}

#[test]
fn initialize_twice_returns_already_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PremiumCalculator, ());
    let client = PremiumCalculatorClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&admin);
    let err = client.try_initialize(&admin).unwrap_err().unwrap();
    assert_eq!(err, CalcError::AlreadyInitialized);
}

// ── compute ───────────────────────────────────────────────────────────────────

#[test]
fn compute_happy_path_returns_positive_premium() {
    let (env, client, _admin) = setup();
    let result = client.compute(&sample_input(&env));
    assert!(result.premium > 0, "premium must be positive");
    assert_eq!(result.config_version, 1u32);
}

#[test]
fn compute_applies_multipliers_deterministically() {
    let (_env, client, _admin) = setup();
    // Medium(10000) * Adult(10000) * Standard(10000) * safety(10000 - 50%*2000)
    // = base * 1 * 1 * 1 * 0.9 = 900_000
    let input = CalcInput {
        region: RegionTier::Medium,
        age_band: AgeBand::Adult,
        coverage: CoverageTier::Standard,
        safety_score: 50,
        base_amount: 1_000_000,
    };
    let result = client.compute(&input);
    let safety = SCALE - (50i128 * 2_000 / 100);
    let expected =
        (((1_000_000i128 * 10_000 / SCALE) * 10_000 / SCALE) * 10_000 / SCALE) * safety / SCALE;
    assert_eq!(result.premium, expected.max(1));
}

#[test]
fn compute_rejects_zero_base_amount() {
    let (env, client, _admin) = setup();
    let mut input = sample_input(&env);
    input.base_amount = 0;
    let err = client.try_compute(&input).unwrap_err().unwrap();
    assert_eq!(err, CalcError::InvalidBaseAmount);
}

#[test]
fn compute_rejects_negative_base_amount() {
    let (env, client, _admin) = setup();
    let mut input = sample_input(&env);
    input.base_amount = -1;
    let err = client.try_compute(&input).unwrap_err().unwrap();
    assert_eq!(err, CalcError::InvalidBaseAmount);
}

#[test]
fn compute_rejects_safety_score_out_of_range() {
    let (env, client, _admin) = setup();
    let mut input = sample_input(&env);
    input.safety_score = 101;
    let err = client.try_compute(&input).unwrap_err().unwrap();
    assert_eq!(err, CalcError::SafetyScoreOutOfRange);
}

#[test]
fn compute_before_initialize_returns_not_initialized() {
    let env = Env::default();
    let contract_id = env.register(PremiumCalculator, ());
    let client = PremiumCalculatorClient::new(&env, &contract_id);
    let err = client
        .try_compute(&sample_input(&env))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, CalcError::NotInitialized);
}

#[test]
fn compute_while_paused_returns_paused() {
    let (env, client, _admin) = setup();
    client.set_paused(&true);
    let err = client
        .try_compute(&sample_input(&env))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, CalcError::Paused);
}

#[test]
fn compute_after_unpause_succeeds() {
    let (env, client, _admin) = setup();
    client.set_paused(&true);
    client.set_paused(&false);
    let result = client.compute(&sample_input(&env));
    assert!(result.premium > 0);
}

// ── get_version / version ─────────────────────────────────────────────────────

#[test]
fn get_version_zero_before_initialize() {
    let env = Env::default();
    let contract_id = env.register(PremiumCalculator, ());
    let client = PremiumCalculatorClient::new(&env, &contract_id);
    assert_eq!(client.get_version(), 0u32);
}

#[test]
fn version_string_matches_cargo_pkg() {
    let env = Env::default();
    let contract_id = env.register(PremiumCalculator, ());
    let client = PremiumCalculatorClient::new(&env, &contract_id);
    let expected = soroban_sdk::String::from_str(&env, env!("CARGO_PKG_VERSION"));
    assert_eq!(client.version(), expected);
}

// ── update_table ──────────────────────────────────────────────────────────────

#[test]
fn update_table_happy_path_bumps_version() {
    let (env, client, _admin) = setup();
    client.update_table(&valid_table(&env, 2));
    assert_eq!(client.get_version(), 2u32);

    let result = client.compute(&sample_input(&env));
    assert_eq!(result.config_version, 2u32);
}

#[test]
fn update_table_rejects_non_increasing_version() {
    let (env, client, _admin) = setup();
    let err = client
        .try_update_table(&valid_table(&env, 1))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, CalcError::InvalidConfigVersion);
}

#[test]
fn update_table_rejects_out_of_bounds_multiplier() {
    let (env, client, _admin) = setup();
    let mut table = valid_table(&env, 2);
    table.region.set(RegionTier::Low, 1); // below MIN_MULTIPLIER
    let err = client.try_update_table(&table).unwrap_err().unwrap();
    assert_eq!(err, CalcError::RegionMultiplierOutOfBounds);
}

#[test]
fn update_table_before_initialize_returns_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PremiumCalculator, ());
    let client = PremiumCalculatorClient::new(&env, &contract_id);
    let err = client
        .try_update_table(&valid_table(&env, 1))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, CalcError::NotInitialized);
}

// ── set_paused ────────────────────────────────────────────────────────────────

#[test]
fn set_paused_before_initialize_returns_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PremiumCalculator, ());
    let client = PremiumCalculatorClient::new(&env, &contract_id);
    let err = client.try_set_paused(&true).unwrap_err().unwrap();
    assert_eq!(err, CalcError::NotInitialized);
}
