//! Solvency-ratio gate tests for policy initiation.

#![cfg(test)]

use niffyinsure::{
    types::{
        AgeBand, CoverageTier, InitiatePolicyOptions, MIN_SOLVENCY_RATIO_BPS_MAX, PolicyType,
        RegionTier,
    },
    validate::Error as ValidateError,
    NiffyInsureClient, PolicyError,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

fn setup() -> (Env, Address, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token);
    (env, contract_id, client, admin, token)
}

fn fund_holder(env: &Env, client: &NiffyInsureClient<'_>, token: &Address, holder: &Address) {
    let amount = 100_000_000i128;
    token::StellarAssetClient::new(env, token).mint(holder, &amount);
    token::Client::new(env, token).approve(
        holder,
        &client.address,
        &amount,
        &(env.ledger().sequence() + 10_000),
    );
}

fn try_initiate(
    env: &Env,
    client: &NiffyInsureClient,
    holder: &Address,
    token: &Address,
    coverage: i128,
) -> Result<niffyinsure::types::Policy, PolicyError> {
    match client.try_initiate_policy(
        holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &coverage,
        token,
        &InitiatePolicyOptions::test_defaults(env),
    ) {
        Ok(Ok(policy)) => Ok(policy),
        Err(Ok(e)) => Err(e),
        Ok(Err(_)) => panic!("unexpected conversion error on initiate_policy"),
        Err(Err(_)) => panic!("unexpected invoke error on initiate_policy"),
    }
}

#[test]
fn solvent_state_allows_policy_initiation() {
    let (env, contract_id, client, _, token) = setup();
    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);
    token::StellarAssetClient::new(&env, &token).mint(&contract_id, &2_000_000i128);

    client.admin_set_min_solvency_ratio_bps(&10_000u32);

    let policy = try_initiate(&env, &client, &holder, &token, 1_000_000)
        .expect("2:1 treasury coverage satisfies 100% solvency");
    assert!(policy.is_active);
}

#[test]
fn insolvent_state_reverts_policy_initiation() {
    let (env, contract_id, client, _, token) = setup();
    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);
    token::StellarAssetClient::new(&env, &token).mint(&contract_id, &499_999i128);

    client.admin_set_min_solvency_ratio_bps(&5_000u32);

    let err = match try_initiate(&env, &client, &holder, &token, 1_000_000) {
        Err(e) => e,
        Ok(_) => panic!("expected InsufficientSolvency"),
    };
    assert_eq!(err, PolicyError::InsufficientSolvency);
}

#[test]
fn threshold_boundary_is_inclusive_exact_ratio() {
    let (env, contract_id, client, _, token) = setup();
    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);
    token::StellarAssetClient::new(&env, &token).mint(&contract_id, &500_000i128);

    client.admin_set_min_solvency_ratio_bps(&5_000u32);

    let policy = try_initiate(&env, &client, &holder, &token, 1_000_000)
        .expect("exactly 50% ratio should satisfy a 5_000 bps threshold");
    assert!(policy.is_active);
}

#[test]
fn admin_can_update_threshold_within_bounds() {
    let (_env, _contract_id, client, _, _) = setup();
    client.admin_set_min_solvency_ratio_bps(&MIN_SOLVENCY_RATIO_BPS_MAX);
    assert_eq!(
        client.get_min_solvency_ratio_bps(),
        MIN_SOLVENCY_RATIO_BPS_MAX
    );
}

#[test]
fn admin_cannot_update_threshold_above_bounds() {
    let (_env, _contract_id, client, _, _) = setup();
    let err = client
        .try_admin_set_min_solvency_ratio_bps(&(MIN_SOLVENCY_RATIO_BPS_MAX + 1))
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, ValidateError::SolvencyRatioOutOfBounds.into());
}
