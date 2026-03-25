#![cfg(test)]

use niffyinsure::{
    premium::{
        checked_div, checked_mul_ratio, compute_premium, default_multiplier_table, round_to_multiple,
        Rounding, MAX_MULTIPLIER, MIN_MULTIPLIER,
    },
    types::{AgeBand, CoverageType, MultiplierTable, RiskInput, RegionTier},
    validate::Error,
    NiffyInsureClient,
};
use soroban_sdk::{map, testutils::Address as _, Address, Env, Map};

fn risk_input(
    region: RegionTier,
    age_band: AgeBand,
    coverage: CoverageType,
    safety_score: u32,
) -> RiskInput {
    RiskInput {
        region,
        age_band,
        coverage,
        safety_score,
    }
}

fn make_table(
    env: &Env,
    region_value: i128,
    age_value: i128,
    coverage_value: i128,
    safety_discount: i128,
    version: u32,
) -> MultiplierTable {
    let region = map![
        env,
        (RegionTier::Low, region_value),
        (RegionTier::Medium, region_value),
        (RegionTier::High, region_value)
    ];
    let age = map![
        env,
        (AgeBand::Young, age_value),
        (AgeBand::Adult, age_value),
        (AgeBand::Senior, age_value)
    ];
    let coverage = map![
        env,
        (CoverageType::Basic, coverage_value),
        (CoverageType::Standard, coverage_value),
        (CoverageType::Premium, coverage_value)
    ];

    MultiplierTable {
        region,
        age,
        coverage,
        safety_discount,
        version,
    }
}

#[test]
fn pure_compute_premium_matches_expected_rounding_order() {
    let env = Env::default();
    let table = default_multiplier_table(&env);
    let input = risk_input(
        RegionTier::High,
        AgeBand::Young,
        CoverageType::Premium,
        80,
    );

    let computation = compute_premium(&input, 12_345_678, &table).unwrap();

    assert_eq!(computation.total_premium, 22_749_999);
    assert_eq!(computation.steps[0].premium, 16_666_666);
    assert_eq!(computation.steps[1].premium, 20_833_333);
    assert_eq!(computation.steps[2].premium, 27_083_333);
    assert_eq!(computation.steps[3].premium, 22_749_999);
}

#[test]
fn rounding_helpers_are_explicit() {
    assert_eq!(round_to_multiple(10_001, 100, Rounding::Floor).unwrap(), 10_000);
    assert_eq!(round_to_multiple(10_001, 100, Rounding::Ceil).unwrap(), 10_100);
    assert_eq!(
        checked_mul_ratio(12_345_678, 13_500, 10_000, Rounding::Ceil).unwrap(),
        16_666_666
    );
    assert_eq!(
        checked_mul_ratio(27_083_333, 8_400, 10_000, Rounding::Floor).unwrap(),
        22_749_999
    );
}

#[test]
fn divide_by_zero_paths_return_actionable_errors() {
    assert_eq!(checked_div(1, 0), Err(Error::DivideByZero));
    assert_eq!(
        checked_mul_ratio(10, 20, 0, Rounding::Floor),
        Err(Error::DivideByZero)
    );
}

#[test]
fn extreme_inputs_do_not_wrap_and_overflow_is_reported() {
    let env = Env::default();
    let table = make_table(&env, MAX_MULTIPLIER, MAX_MULTIPLIER, MAX_MULTIPLIER, 0, 2);
    let input = risk_input(
        RegionTier::High,
        AgeBand::Senior,
        CoverageType::Premium,
        100,
    );

    for base in [
        1i128,
        10_000_000i128,
        i128::MAX / MAX_MULTIPLIER,
        (i128::MAX / MAX_MULTIPLIER) + 1,
        i128::MAX,
    ] {
        let result = compute_premium(&input, base, &table);
        if base <= i128::MAX / MAX_MULTIPLIER {
            assert!(result.is_ok());
        } else {
            assert_eq!(result, Err(Error::Overflow));
        }
    }
}

#[test]
fn min_and_max_multiplier_tables_produce_monotonic_outputs() {
    let env = Env::default();
    let low_table = make_table(&env, MIN_MULTIPLIER, MIN_MULTIPLIER, MIN_MULTIPLIER, 0, 2);
    let high_table = make_table(&env, MAX_MULTIPLIER, MAX_MULTIPLIER, MAX_MULTIPLIER, 0, 3);
    let input = risk_input(
        RegionTier::Medium,
        AgeBand::Adult,
        CoverageType::Standard,
        0,
    );

    let low = compute_premium(&input, 1_000_000, &low_table).unwrap();
    let high = compute_premium(&input, 1_000_000, &high_table).unwrap();

    assert!(low.total_premium <= high.total_premium);
}

#[test]
fn invalid_table_rows_cannot_be_persisted() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);

    let before = client.get_multiplier_table();
    let invalid = make_table(&env, 4_999, 10_000, 10_000, 2_000, before.version + 1);
    let result = client.try_update_multiplier_table(&invalid);

    assert!(result.is_err());
    assert_eq!(client.get_multiplier_table(), before);
}

#[test]
fn valid_table_update_persists_and_emits_a_new_version() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);

    let before = client.get_multiplier_table();
    let updated = make_table(&env, 10_500, 11_000, 12_000, 1_500, before.version + 1);

    client.update_multiplier_table(&updated);

    assert_eq!(client.get_multiplier_table(), updated);
}

#[test]
fn stale_version_updates_are_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);

    let current = client.get_multiplier_table();
    let stale = make_table(
        &env,
        10_000,
        10_000,
        10_000,
        1_000,
        current.version,
    );

    let result = client.try_update_multiplier_table(&stale);
    assert!(result.is_err());
    assert_eq!(client.get_multiplier_table(), current);
}

#[test]
fn missing_rows_are_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);

    let mut region = Map::new(&env);
    region.set(RegionTier::Low, 10_000);
    region.set(RegionTier::Medium, 10_000);

    let age = map![
        &env,
        (AgeBand::Young, 10_000),
        (AgeBand::Adult, 10_000),
        (AgeBand::Senior, 10_000)
    ];
    let coverage = map![
        &env,
        (CoverageType::Basic, 10_000),
        (CoverageType::Standard, 10_000),
        (CoverageType::Premium, 10_000)
    ];

    let invalid = MultiplierTable {
        region,
        age,
        coverage,
        safety_discount: 1_000,
        version: 2,
    };

    let result = client.try_update_multiplier_table(&invalid);
    assert!(result.is_err());
}
