#![cfg(test)]

//! Calculator cross-contract call failure behaviour (fail-open + CalculatorFallback).

use niffyinsure::{
    types::{AgeBand, CalcSource, CoverageTier, RegionTier, RiskInput},
    NiffyInsureClient,
};
use premium_calculator::{PremiumCalculatorClient, ABI_VERSION};
use soroban_sdk::{
    testutils::{Address as _, Events},
    Address, Env,
};

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

fn assert_fallback_emitted(env: &Env) {
    let events = env.events().all();
    assert!(
        events.events().len() > 0,
        "CalculatorFallback must be emitted when falling back"
    );
}

#[test]
fn no_calculator_uses_local_engine_successfully() {
    let (_env, client, _) = setup_policy();
    let quote = client
        .try_generate_premium(&risk(), &10_000_000i128, &false)
        .unwrap()
        .unwrap();
    assert!(quote.premium > 0);
    assert_eq!(quote.calc_source, CalcSource::Local);
}

#[test]
fn happy_path_external_calculator_returns_external_source() {
    let (env, client, admin) = setup_policy();
    let calc_id = setup_calculator(&env, &admin);
    client.set_calculator_with_version(&calc_id, &ABI_VERSION);

    let input = risk();
    let (quote, source) = env
        .as_contract(&client.address, || {
            niffyinsure::calculator::compute_quote_readonly(
                &env, &input, 10_000_000, false, 100, None,
            )
        })
        .expect("successful calculator call");

    assert!(quote.total_premium > 0);
    assert_eq!(source, CalcSource::External);
}

#[test]
fn paused_calculator_falls_back_to_local_and_emits_event() {
    let (env, client, admin) = setup_policy();
    let calc_id = setup_calculator(&env, &admin);
    let calc = PremiumCalculatorClient::new(&env, &calc_id);
    calc.set_paused(&true);
    client.set_calculator(&calc_id);

    let _ = env.events().all(); // drain
    let input = risk();
    let (quote, source) = env
        .as_contract(&client.address, || {
            niffyinsure::calculator::compute_quote_readonly(
                &env, &input, 10_000_000, false, 100, None,
            )
        })
        .expect("paused calculator must fall back to local");

    assert!(quote.total_premium > 0);
    assert_eq!(source, CalcSource::Local);
    assert_fallback_emitted(&env);
}

#[test]
fn wrong_abi_falls_back_to_local_and_emits_event() {
    let (env, client, admin) = setup_policy();
    let calc_id = setup_calculator(&env, &admin);
    client.set_calculator_with_version(&calc_id, &999u32);

    let _ = env.events().all();
    let input = risk();
    let (quote, source) = env
        .as_contract(&client.address, || {
            niffyinsure::calculator::compute_quote_readonly(
                &env, &input, 10_000_000, false, 100, None,
            )
        })
        .expect("wrong ABI must fall back to local");

    assert!(quote.total_premium > 0);
    assert_eq!(source, CalcSource::Local);
    assert_fallback_emitted(&env);
}

#[test]
fn panicking_unreachable_calculator_falls_back_to_local() {
    let (env, client, _) = setup_policy();
    let bogus = Address::generate(&env);
    client.set_calculator(&bogus);

    let _ = env.events().all();
    let input = risk();
    let (quote, source) = env
        .as_contract(&client.address, || {
            niffyinsure::calculator::compute_quote_readonly(
                &env, &input, 10_000_000, false, 100, None,
            )
        })
        .expect("unreachable calculator must fall back to local");

    assert!(quote.total_premium > 0);
    assert_eq!(source, CalcSource::Local);
    assert_fallback_emitted(&env);
}
