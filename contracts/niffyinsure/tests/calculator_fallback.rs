#![cfg(test)]

//! Calculator cross-contract call failure behaviour (fail-closed).
//!
//! When a calculator address is configured, a failing call must surface a
//! typed error — never silently fall back to the local premium engine.

use niffyinsure::{
    types::{AgeBand, CoverageTier, RegionTier, RiskInput},
    NiffyInsureClient,
};
use premium_calculator::PremiumCalculatorClient;
use soroban_sdk::{testutils::Address as _, Address, Env};

fn risk() -> RiskInput {
    RiskInput {
        region: RegionTier::Medium,
        age_band: AgeBand::Adult,
        coverage: CoverageTier::Standard,
        safety_score: 50,
    }
}

fn setup_policy() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin)
}

fn setup_calculator(env: &Env, admin: &Address) -> Address {
    let calc_id = env.register(premium_calculator::PremiumCalculator, ());
    let calc = PremiumCalculatorClient::new(env, &calc_id);
    calc.initialize(admin);
    calc_id
}

#[test]
fn no_calculator_uses_local_engine_successfully() {
    let (_env, client, _) = setup_policy();
    let quote = client
        .try_generate_premium(&risk(), &10_000_000i128, &false)
        .unwrap()
        .unwrap();
    assert!(quote.total_premium > 0);
}

#[test]
fn paused_calculator_returns_typed_paused_error_not_local_fallback() {
    let (env, client, admin) = setup_policy();
    let calc_id = setup_calculator(&env, &admin);
    let calc = PremiumCalculatorClient::new(&env, &calc_id);
    calc.set_paused(&true);

    client.set_calculator(&calc_id);

    // initiate_policy / renew go through compute_quote. generate_premium is
    // local-only today — exercise compute_quote via a bind path that uses it.
    // Use env.as_contract to call calculator::compute_quote directly.
    let input = risk();
    let result = env.as_contract(&client.address, || {
        niffyinsure::calculator::compute_quote(&env, &input, 10_000_000, false, 100, None)
    });

    assert_eq!(
        result,
        Err(niffyinsure::validate::Error::CalculatorPaused),
        "paused calculator must return CalculatorPaused, not a local quote"
    );
}

#[test]
fn unreachable_calculator_returns_calculator_call_failed() {
    let (env, client, _) = setup_policy();
    // Point at an address with no deployed contract → host invoke failure.
    let bogus = Address::generate(&env);
    client.set_calculator(&bogus);

    let input = risk();
    let result = env.as_contract(&client.address, || {
        niffyinsure::calculator::compute_quote(&env, &input, 10_000_000, false, 100, None)
    });

    assert_eq!(
        result,
        Err(niffyinsure::validate::Error::CalculatorCallFailed),
        "unreachable calculator must return CalculatorCallFailed (fail-closed)"
    );
}

#[test]
fn successful_external_calculator_call_returns_quote() {
    let (env, client, admin) = setup_policy();
    let calc_id = setup_calculator(&env, &admin);
    client.set_calculator(&calc_id);

    let input = risk();
    let quote = env
        .as_contract(&client.address, || {
            niffyinsure::calculator::compute_quote(&env, &input, 10_000_000, false, 100, None)
        })
        .expect("successful calculator call");

    assert!(quote.total_premium > 0);
}
