#![cfg(test)]

//! Quote entrypoints: generate_premium / generate_premium_for_asset / quote_error_message.
//!
//! Asserts read-only behaviour (no storage mutations) and every quote error path.

use niffyinsure::{
    types::{AgeBand, CalcSource, CoverageTier, RegionTier, RiskInput},
    validate::Error,
    NiffyInsureClient,
};
use soroban_sdk::{testutils::Address as _, Address, Env};

fn default_risk_input() -> RiskInput {
    RiskInput {
        region: RegionTier::Medium,
        age_band: AgeBand::Adult,
        coverage: CoverageTier::Standard,
        safety_score: 50,
    }
}

fn setup() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin)
}

#[test]
fn repeated_generate_premium_calls_do_not_mutate_storage() {
    let (_env, client, _) = setup();

    let holder = Address::generate(&_env);
    let before_claim_counter = client.get_claim_counter();
    let before_policy_counter = client.get_policy_counter(&holder);
    let before_table = client.get_multiplier_table();
    let before_has_policy = client.has_policy(&holder, &1u32);
    let before_calc = client.get_calculator();
    let before_last_abi = client.get_last_calc_abi_version();

    let input = default_risk_input();
    let first = client.generate_premium(&input, &10_000_000i128, &true);
    let second = client.generate_premium(&input, &10_000_000i128, &false);

    assert_eq!(first.premium, 9_000_000);
    assert_eq!(first.coverage, 10_000_000);
    assert_eq!(first.calc_source, CalcSource::Local);
    assert!(first.asset.is_none());
    assert_eq!(first.table_version, before_table.version);
    assert_eq!(second.premium, first.premium);

    // Footprint / storage diff: no counters, table, calculator, or ABI pin writes.
    assert_eq!(before_claim_counter, client.get_claim_counter());
    assert_eq!(before_policy_counter, client.get_policy_counter(&holder));
    assert_eq!(before_has_policy, client.has_policy(&holder, &1u32));
    assert_eq!(before_table, client.get_multiplier_table());
    assert_eq!(before_calc, client.get_calculator());
    assert_eq!(before_last_abi, client.get_last_calc_abi_version());
}

#[test]
fn generate_premium_matches_golden_vectors_bit_for_bit() {
    let (_env, client, _) = setup();

    let medium_adult_standard = RiskInput {
        region: RegionTier::Medium,
        age_band: AgeBand::Adult,
        coverage: CoverageTier::Standard,
        safety_score: 50,
    };
    let high_young_premium = RiskInput {
        region: RegionTier::High,
        age_band: AgeBand::Young,
        coverage: CoverageTier::Premium,
        safety_score: 80,
    };
    let low_senior_basic = RiskInput {
        region: RegionTier::Low,
        age_band: AgeBand::Senior,
        coverage: CoverageTier::Basic,
        safety_score: 0,
    };

    assert_eq!(
        client
            .generate_premium(&medium_adult_standard, &10_000_000i128, &false)
            .premium,
        9_000_000
    );
    assert_eq!(
        client
            .generate_premium(&high_young_premium, &12_345_678i128, &false)
            .premium,
        22_749_999
    );
    assert_eq!(
        client
            .generate_premium(&low_senior_basic, &7_654_321i128, &false)
            .premium,
        6_733_890
    );
}

#[test]
fn generate_premium_returns_structured_validation_errors() {
    let (_env, client, _) = setup();

    let bad_input = RiskInput {
        region: RegionTier::Low,
        age_band: AgeBand::Adult,
        coverage: CoverageTier::Basic,
        safety_score: 101,
    };

    let bad_input_result = client.try_generate_premium(&bad_input, &10_000_000i128, &false);
    assert!(bad_input_result.is_err());

    let bad_base_result = client.try_generate_premium(&default_risk_input(), &0i128, &false);
    assert!(bad_base_result.is_err());

    let below_min = client.try_generate_premium(&default_risk_input(), &1i128, &false);
    assert!(below_min.is_err());

    let safety_msg = client.quote_error_message(&(Error::SafetyScoreOutOfRange as u32));
    let base_msg = client.quote_error_message(&(Error::InvalidBaseAmount as u32));
    let floor_msg = client.quote_error_message(&(Error::ClaimBelowMinAmount as u32));

    assert_eq!(safety_msg.code, Error::SafetyScoreOutOfRange as u32);
    assert_eq!(base_msg.code, Error::InvalidBaseAmount as u32);
    assert_eq!(floor_msg.code, Error::ClaimBelowMinAmount as u32);
    assert!(!safety_msg.message.is_empty());
    assert!(!base_msg.message.is_empty());
    assert!(!floor_msg.message.is_empty());

    let snap_msg = client.quote_error_message(&(Error::VoterSnapshotExpired as u32));
    assert_eq!(snap_msg.code, Error::VoterSnapshotExpired as u32);
    assert!(!snap_msg.message.is_empty());
}

#[test]
fn generate_premium_for_asset_rejects_non_allowlisted_asset() {
    let (env, client, _) = setup();
    let unknown = Address::generate(&env);
    let err = client.try_generate_premium_for_asset(
        &default_risk_input(),
        &10_000_000i128,
        &false,
        &unknown,
    );
    assert!(err.is_err());
    let msg = client.quote_error_message(&(Error::InvalidAsset as u32));
    assert!(!msg.message.is_empty());
}

#[test]
fn generate_premium_for_asset_rejects_coverage_above_asset_max() {
    let (env, client, _) = setup();
    let asset = Address::generate(&env);
    client.set_allowed_asset(&asset, &true, &soroban_sdk::String::from_str(&env, "USDC"), &7u32);
    client.admin_set_asset_claim_bounds(&asset, &1_000_000i128, &5_000_000i128);

    let err = client.try_generate_premium_for_asset(
        &default_risk_input(),
        &10_000_000i128,
        &false,
        &asset,
    );
    assert!(err.is_err());
    let msg = client.quote_error_message(&(Error::ClaimAboveMaxAmount as u32));
    assert_eq!(msg.code, Error::ClaimAboveMaxAmount as u32);
    assert!(!msg.message.is_empty());
}

#[test]
fn quote_error_message_covers_every_quote_failure_code() {
    let (_env, client, _) = setup();
    let codes = [
        Error::InvalidBaseAmount as u32,
        Error::SafetyScoreOutOfRange as u32,
        Error::ClaimBelowMinAmount as u32,
        Error::ClaimAboveMaxAmount as u32,
        Error::InvalidAsset as u32,
        Error::PolicyInactive as u32,
        Error::Overflow as u32,
        Error::MissingRegionMultiplier as u32,
        Error::CalculatorCallFailed as u32,
        Error::CalculatorPaused as u32,
        Error::CalculatorVersionMismatch as u32,
    ];
    for code in codes {
        let msg = client.quote_error_message(&code);
        assert_eq!(msg.code, code);
        assert!(!msg.message.is_empty(), "code {code} must have a message");
    }
}
