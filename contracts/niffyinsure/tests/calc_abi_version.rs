//! Calculator ABI version pin: expected pin + last-successful recording.

#![cfg(test)]

use niffyinsure::{
    calculator,
    types::{AgeBand, CoverageTier, RegionTier, RiskInput},
    NiffyInsureClient,
};
use premium_calculator::{PremiumCalculator, PremiumCalculatorClient, ABI_VERSION};
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup_with_calc() -> (Env, Address, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let insure_id = env.register(niffyinsure::NiffyInsure, ());
    let calc_id = env.register(PremiumCalculator, ());
    let insure = NiffyInsureClient::new(&env, &insure_id);
    let calc = PremiumCalculatorClient::new(&env, &calc_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    insure.initialize(&admin, &token);
    calc.initialize(&admin);
    (env, insure_id, insure, admin, calc_id)
}

fn sample_risk() -> RiskInput {
    RiskInput {
        region: RegionTier::Medium,
        age_band: AgeBand::Adult,
        coverage: CoverageTier::Standard,
        safety_score: 50,
    }
}

#[test]
fn abi_version_exposed_by_calculator() {
    let env = Env::default();
    let calc_id = env.register(PremiumCalculator, ());
    let calc = PremiumCalculatorClient::new(&env, &calc_id);
    assert_eq!(calc.abi_version(), ABI_VERSION);
    assert_eq!(calc.abi_version(), 1);
}

#[test]
fn last_calc_abi_version_recorded_on_successful_compute() {
    let (env, insure_id, insure, _admin, calc_id) = setup_with_calc();
    assert!(insure.get_last_calc_abi_version().is_none());

    insure.set_calculator_with_version(&calc_id, &ABI_VERSION);
    assert_eq!(insure.get_expected_calc_version(), Some(ABI_VERSION));

    let quote = env.as_contract(&insure_id, || {
        calculator::compute_quote(&env, &sample_risk(), 1_000_000, false, 100, None).unwrap()
    });
    assert!(quote.total_premium > 0);
    assert_eq!(insure.get_last_calc_abi_version(), Some(ABI_VERSION));
}

#[test]
fn matching_abi_pin_allows_normal_operation() {
    let (env, insure_id, insure, _admin, calc_id) = setup_with_calc();
    insure.set_calculator_with_version(&calc_id, &ABI_VERSION);

    let ok = env.as_contract(&insure_id, || {
        calculator::compute_quote(&env, &sample_risk(), 1_000_000, false, 100, None)
    });
    assert!(ok.is_ok());
    assert_eq!(insure.get_last_calc_abi_version(), Some(ABI_VERSION));
}

#[test]
fn version_mismatch_rejects_when_pin_differs() {
    let (env, insure_id, insure, _admin, calc_id) = setup_with_calc();

    insure.set_calculator_with_version(&calc_id, &999u32);
    assert_eq!(insure.get_expected_calc_version(), Some(999u32));

    let err = env.as_contract(&insure_id, || {
        calculator::compute_quote(&env, &sample_risk(), 1_000_000, false, 100, None)
    });
    assert_eq!(
        err,
        Err(niffyinsure::validate::Error::CalculatorVersionMismatch)
    );
    assert!(insure.get_last_calc_abi_version().is_none());
}
