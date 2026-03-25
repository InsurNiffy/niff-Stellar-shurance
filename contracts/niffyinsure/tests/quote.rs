#![cfg(test)]

use niffyinsure::{
    types::{AgeBand, CoverageType, RiskInput, RegionTier},
    validate::Error,
    NiffyInsureClient,
};
use soroban_sdk::{testutils::Address as _, Address, Env};

fn default_risk_input() -> RiskInput {
    RiskInput {
        region: RegionTier::Medium,
        age_band: AgeBand::Adult,
        coverage: CoverageType::Standard,
        safety_score: 50,
    }
}

#[test]
fn repeated_generate_premium_calls_do_not_mutate_counters_or_policy_map() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);

    let holder = Address::generate(&env);
    let before_claim_counter = client.get_claim_counter();
    let before_policy_counter = client.get_policy_counter(&holder);
    let before_has_policy = client.has_policy(&holder, &1u32);

    let input = default_risk_input();
    let first = client.generate_premium(&input, &10_000_000i128, &true);
    let second = client.generate_premium(&input, &10_000_000i128, &false);

    assert_eq!(first.total_premium, 9_000_000);
    assert!(first.line_items.is_some());
    assert!(second.line_items.is_none());

    assert_eq!(before_claim_counter, client.get_claim_counter());
    assert_eq!(before_policy_counter, client.get_policy_counter(&holder));
    assert_eq!(before_has_policy, client.has_policy(&holder, &1u32));
}

#[test]
fn generate_premium_matches_golden_vectors_bit_for_bit() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);

    let medium_adult_standard = RiskInput {
        region: RegionTier::Medium,
        age_band: AgeBand::Adult,
        coverage: CoverageType::Standard,
        safety_score: 50,
    };
    let high_young_premium = RiskInput {
        region: RegionTier::High,
        age_band: AgeBand::Young,
        coverage: CoverageType::Premium,
        safety_score: 80,
    };
    let low_senior_basic = RiskInput {
        region: RegionTier::Low,
        age_band: AgeBand::Senior,
        coverage: CoverageType::Basic,
        safety_score: 0,
    };

    assert_eq!(
        client
            .generate_premium(&medium_adult_standard, &10_000_000i128, &false)
            .total_premium,
        9_000_000
    );
    assert_eq!(
        client
            .generate_premium(&high_young_premium, &12_345_678i128, &false)
            .total_premium,
        22_749_999
    );
    assert_eq!(
        client
            .generate_premium(&low_senior_basic, &7_654_321i128, &false)
            .total_premium,
        6_737_647
    );
}

#[test]
fn generate_premium_returns_structured_validation_errors() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);

    let bad_input = RiskInput {
        region: RegionTier::Low,
        age_band: AgeBand::Adult,
        coverage: CoverageType::Basic,
        safety_score: 101,
    };

    let bad_input_result = client.try_generate_premium(&bad_input, &10_000_000i128, &false);
    assert!(bad_input_result.is_err());

    let bad_base_result = client.try_generate_premium(&default_risk_input(), &0i128, &false);
    assert!(bad_base_result.is_err());

    let safety_msg = client.quote_error_message(&(Error::SafetyScoreOutOfRange as u32));
    let base_msg = client.quote_error_message(&(Error::InvalidBaseAmount as u32));

    assert_eq!(safety_msg.code, Error::SafetyScoreOutOfRange as u32);
    assert_eq!(base_msg.code, Error::InvalidBaseAmount as u32);
    assert!(safety_msg.message.len() > 0);
    assert!(base_msg.message.len() > 0);
}
