//! Duplicate active coverage: a holder cannot hold two active policies with
//! the same asset type (`policy_type`) and `region` whose ledger windows
//! overlap. Adjacent (non-overlapping) windows and different asset types are
//! both allowed.

#![cfg(test)]

use niffyinsure::{
    policy::PolicyError,
    types::{AgeBand, CoverageTier, PolicyType, RegionTier},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

const INITIAL_LEDGER: u32 = 400;
const STARTING_BALANCE: i128 = 10_000_000_000;
/// Matches `ledger::POLICY_DURATION_LEDGERS` (30 days).
const POLICY_DURATION_LEDGERS: u32 = 30 * 17280;

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.sequence_number = INITIAL_LEDGER;
    });
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

fn fund_holder(env: &Env, client: &NiffyInsureClient<'_>, token: &Address, holder: &Address) {
    token::StellarAssetClient::new(env, token).mint(holder, &STARTING_BALANCE);
    token::Client::new(env, token).approve(
        holder,
        &client.address,
        &STARTING_BALANCE,
        &(env.ledger().sequence() + 1_000_000),
    );
}

/// Returns `Ok(())` on success, or `Err(PolicyError)` on revert.
fn bind(
    client: &NiffyInsureClient<'_>,
    env: &Env,
    holder: &Address,
    token: &Address,
    policy_type: PolicyType,
    region: RegionTier,
) -> Result<(), PolicyError> {
    client
        .try_initiate_policy(
            holder,
            &policy_type,
            &region,
            &AgeBand::Adult,
            &CoverageTier::Standard,
            &80,
            &1_000_000,
            token,
            &niffyinsure::types::InitiatePolicyOptions::test_defaults(env),
        )
        .map(|_| ())
        .map_err(|e| e.unwrap())
}

#[test]
fn exact_overlap_same_asset_and_region_reverts() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    let first = bind(&client, &env, &holder, &token, PolicyType::Auto, RegionTier::Medium);
    assert!(first.is_ok());

    let second = bind(&client, &env, &holder, &token, PolicyType::Auto, RegionTier::Medium);
    assert_eq!(second, Err(PolicyError::DuplicateCoverageActive));
}

#[test]
fn adjacent_non_overlapping_windows_are_allowed() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    let first = bind(&client, &env, &holder, &token, PolicyType::Auto, RegionTier::Medium);
    assert!(first.is_ok());

    // Advance past the first policy's end_ledger so the windows no longer overlap.
    env.ledger().with_mut(|l| {
        l.sequence_number = INITIAL_LEDGER + POLICY_DURATION_LEDGERS + 1;
    });

    let second = bind(&client, &env, &holder, &token, PolicyType::Auto, RegionTier::Medium);
    assert!(second.is_ok(), "adjacent non-overlapping window should be allowed");
}

#[test]
fn different_asset_type_is_allowed() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    let first = bind(&client, &env, &holder, &token, PolicyType::Auto, RegionTier::Medium);
    assert!(first.is_ok());

    let second = bind(&client, &env, &holder, &token, PolicyType::Property, RegionTier::Medium);
    assert!(second.is_ok(), "different asset type (policy_type) should be allowed");
}

#[test]
fn different_region_is_allowed() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    let first = bind(&client, &env, &holder, &token, PolicyType::Auto, RegionTier::Medium);
    assert!(first.is_ok());

    let second = bind(&client, &env, &holder, &token, PolicyType::Auto, RegionTier::Low);
    assert!(second.is_ok(), "different region should be allowed");
}
