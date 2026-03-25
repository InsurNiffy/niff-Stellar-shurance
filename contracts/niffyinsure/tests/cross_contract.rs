//! Integration tests: two-contract deployment (PremiumCalculator + NiffyInsure).
//!
//! Covers:
//! - Quote via external calculator (local fallback baseline)
//! - Calculator address rotation changes pricing
//! - Calculator paused → bind fails closed
//! - Calculator cleared → falls back to built-in engine
//! - set_calculator requires admin auth

#![cfg(test)]

use niffyinsure::{
    types::{AgeBand, CoverageType, RegionTier, RiskInput},
    validate::Error,
    NiffyInsureClient,
};
use premium_calculator::{PremiumCalculatorClient, types::{
    AgeBand as CalcAgeBand, CalcInput, CoverageType as CalcCoverageType,
    RegionTier as CalcRegionTier,
}};
use soroban_sdk::{testutils::Address as _, Address, Env, IntoVal};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup_policy_contract(env: &Env) -> (NiffyInsureClient<'static>, Address, Address, Address) {
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token = Address::generate(env);
    client.initialize(&admin, &token);
    (client, contract_id, admin, token)
}

fn setup_calculator(env: &Env) -> (PremiumCalculatorClient<'static>, Address, Address) {
    let calc_id = env.register(premium_calculator::PremiumCalculator, ());
    let calc_client = PremiumCalculatorClient::new(env, &calc_id);
    let calc_admin = Address::generate(env);
    calc_client.initialize(&calc_admin);
    (calc_client, calc_id, calc_admin)
}

fn standard_risk_input() -> RiskInput {
    RiskInput {
        region: RegionTier::Medium,
        age_band: AgeBand::Adult,
        coverage: CoverageType::Standard,
        safety_score: 0,
    }
}

fn standard_calc_input(base: i128) -> CalcInput {
    CalcInput {
        region: CalcRegionTier::Medium,
        age_band: CalcAgeBand::Adult,
        coverage: CalcCoverageType::Standard,
        safety_score: 0,
        base_amount: base,
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// Without a calculator configured, generate_premium uses the built-in engine.
#[test]
fn generate_premium_uses_local_engine_when_no_calculator_set() {
    let env = Env::default();
    env.mock_all_auths();
    let (policy_client, _, _, _) = setup_policy_contract(&env);

    assert!(policy_client.get_calculator().is_none());

    let quote = policy_client.generate_premium(&standard_risk_input(), &10_000_000i128, &false);
    // Medium/Adult/Standard/0 safety: 10_000_000 * 1.0 * 1.0 * 1.0 * 1.0 = 10_000_000
    assert_eq!(quote.total_premium, 10_000_000);
}

/// After set_calculator, generate_premium routes to the external contract.
#[test]
fn generate_premium_routes_to_external_calculator() {
    let env = Env::default();
    env.mock_all_auths();
    let (policy_client, _, admin, _) = setup_policy_contract(&env);
    let (calc_client, calc_id, _) = setup_calculator(&env);

    // Verify the calculator itself returns the expected value
    let direct = calc_client.compute(&standard_calc_input(10_000_000));
    assert_eq!(direct.premium, 10_000_000);

    // Point policy contract at the calculator
    policy_client.set_calculator(&calc_id);
    assert_eq!(policy_client.get_calculator(), Some(calc_id.clone()));

    // generate_premium should now delegate to the calculator
    let quote = policy_client.generate_premium(&standard_risk_input(), &10_000_000i128, &false);
    assert_eq!(quote.total_premium, direct.premium);
    assert_eq!(quote.config_version, direct.config_version);
}

/// Rotating the calculator address changes the pricing result.
#[test]
fn calculator_rotation_changes_pricing() {
    let env = Env::default();
    env.mock_all_auths();
    let (policy_client, _, _, _) = setup_policy_contract(&env);
    let (calc_client_v1, calc_id_v1, calc_admin_v1) = setup_calculator(&env);
    let (_, calc_id_v2, _) = setup_calculator(&env);

    // Upgrade v1 calculator with a higher-risk table (version 2)
    use premium_calculator::types::{MultiplierTable, RegionTier as CR, AgeBand as CA, CoverageType as CC};
    use soroban_sdk::Map;
    let mut region = Map::new(&env);
    region.set(CR::Low, 9_000i128);
    region.set(CR::Medium, 15_000i128); // higher than default 10_000
    region.set(CR::High, 20_000i128);
    let mut age = Map::new(&env);
    age.set(CA::Young, 12_500i128);
    age.set(CA::Adult, 10_000i128);
    age.set(CA::Senior, 11_500i128);
    let mut coverage = Map::new(&env);
    coverage.set(CC::Basic, 9_000i128);
    coverage.set(CC::Standard, 10_000i128);
    coverage.set(CC::Premium, 13_000i128);
    let new_table = MultiplierTable { region, age, coverage, safety_discount: 2_000, version: 2 };
    calc_client_v1.update_table(&new_table);

    // Use v1 (upgraded) calculator
    policy_client.set_calculator(&calc_id_v1);
    let quote_v1 = policy_client.generate_premium(&standard_risk_input(), &10_000_000i128, &false);
    // Medium multiplier is now 15_000 → 10_000_000 * 15000/10000 = 15_000_000
    assert_eq!(quote_v1.total_premium, 15_000_000);

    // Rotate to v2 calculator (default table, medium = 10_000)
    policy_client.set_calculator(&calc_id_v2);
    let quote_v2 = policy_client.generate_premium(&standard_risk_input(), &10_000_000i128, &false);
    assert_eq!(quote_v2.total_premium, 10_000_000);

    // Pricing changed without redeploying the policy contract
    assert_ne!(quote_v1.total_premium, quote_v2.total_premium);
}

/// When the calculator is paused, generate_premium returns CalculatorPaused.
#[test]
fn paused_calculator_causes_bind_fail_closed() {
    let env = Env::default();
    env.mock_all_auths();
    let (policy_client, _, _, _) = setup_policy_contract(&env);
    let (calc_client, calc_id, _) = setup_calculator(&env);

    policy_client.set_calculator(&calc_id);

    // Pause the calculator
    calc_client.set_paused(&true);

    let result = policy_client.try_generate_premium(&standard_risk_input(), &10_000_000i128, &false);
    assert!(result.is_err(), "expected error when calculator is paused");
    // The error should be CalculatorPaused (code 35)
    let err = result.unwrap_err().unwrap();
    assert_eq!(err, Error::CalculatorPaused);
}

/// Clearing the calculator reverts to the built-in engine.
#[test]
fn clear_calculator_reverts_to_local_engine() {
    let env = Env::default();
    env.mock_all_auths();
    let (policy_client, _, _, _) = setup_policy_contract(&env);
    let (_, calc_id, _) = setup_calculator(&env);

    policy_client.set_calculator(&calc_id);
    assert!(policy_client.get_calculator().is_some());

    policy_client.clear_calculator();
    assert!(policy_client.get_calculator().is_none());

    // Should succeed using local engine
    let quote = policy_client.generate_premium(&standard_risk_input(), &10_000_000i128, &false);
    assert_eq!(quote.total_premium, 10_000_000);
}

/// set_calculator requires admin auth; non-admin call must fail.
#[test]
fn set_calculator_requires_admin_auth() {
    let env = Env::default();
    // Do NOT mock all auths — we want auth to be enforced
    let (policy_client, _, admin, _) = setup_policy_contract(&env);
    let (_, calc_id, _) = setup_calculator(&env);

    // Admin call succeeds
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &admin,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &policy_client.address,
            fn_name: "set_calculator",
            args: (calc_id.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    policy_client.set_calculator(&calc_id);
    assert_eq!(policy_client.get_calculator(), Some(calc_id));
}

/// Calculator get_version returns the current table version (capability flag).
#[test]
fn calculator_get_version_returns_table_version() {
    let env = Env::default();
    env.mock_all_auths();
    let (calc_client, _, _) = setup_calculator(&env);

    assert_eq!(calc_client.get_version(), 1u32);
}

/// Direct calculator compute call works end-to-end.
#[test]
fn calculator_compute_returns_correct_premium() {
    let env = Env::default();
    env.mock_all_auths();
    let (calc_client, _, _) = setup_calculator(&env);

    let result = calc_client.compute(&standard_calc_input(10_000_000));
    assert_eq!(result.premium, 10_000_000);
    assert_eq!(result.config_version, 1);
}

/// Calculator rejects invalid base amount.
#[test]
fn calculator_rejects_zero_base_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (calc_client, _, _) = setup_calculator(&env);

    let bad_input = CalcInput {
        region: CalcRegionTier::Low,
        age_band: CalcAgeBand::Adult,
        coverage: CalcCoverageType::Basic,
        safety_score: 0,
        base_amount: 0,
    };
    let result = calc_client.try_compute(&bad_input);
    assert!(result.is_err());
}
