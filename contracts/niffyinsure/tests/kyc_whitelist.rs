//! Issue #1611 — KYC whitelist admin entrypoints: register/deregister addresses.
//!
//! `admin_add_to_whitelist` / `admin_remove_from_whitelist` and the
//! `is_whitelisted` / `get_whitelist_enabled` getters already existed; this
//! file adds the missing regression coverage for the full lifecycle the
//! issue describes:
//!   - an address starts off the whitelist
//!   - `admin_add_to_whitelist` lets it bind once enforcement is enabled
//!   - `admin_remove_from_whitelist` blocks it again
//!   - enforcement toggling itself is observable via `get_whitelist_enabled`

#![cfg(test)]

use niffyinsure::{
    types::{AgeBand, CoverageTier, InitiatePolicyOptions, PolicyType, RegionTier},
    NiffyInsureClient, PolicyError,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

const INITIAL_LEDGER: u32 = 400;
const STARTING_BALANCE: i128 = 10_000_000_000;
const COVERAGE: i128 = 1_000_000;

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = INITIAL_LEDGER);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

fn fund(env: &Env, client: &NiffyInsureClient<'_>, token: &Address, holder: &Address) {
    token::StellarAssetClient::new(env, token).mint(holder, &STARTING_BALANCE);
    token::Client::new(env, token).approve(
        holder,
        &client.address,
        &STARTING_BALANCE,
        &(env.ledger().sequence() + 50_000),
    );
}

fn try_bind(
    client: &NiffyInsureClient<'_>,
    holder: &Address,
    token: &Address,
    o: &InitiatePolicyOptions,
) -> Result<(), PolicyError> {
    client
        .try_initiate_policy(
            holder,
            &PolicyType::Auto,
            &RegionTier::Medium,
            &AgeBand::Adult,
            &CoverageTier::Standard,
            &80u32,
            &COVERAGE,
            token,
            o,
        )
        .map(|_| ())
        .map_err(|e| e.unwrap())
}

#[test]
fn address_not_whitelisted_by_default() {
    let (env, client, _admin, _token) = setup();
    let holder = Address::generate(&env);
    assert!(!client.is_whitelisted(&holder));
    assert!(!client.get_whitelist_enabled());
}

#[test]
fn admin_add_to_whitelist_marks_address_whitelisted() {
    let (env, client, _admin, _token) = setup();
    let holder = Address::generate(&env);
    client.admin_add_to_whitelist(&holder);
    assert!(client.is_whitelisted(&holder));
}

#[test]
fn admin_remove_from_whitelist_clears_address() {
    let (env, client, _admin, _token) = setup();
    let holder = Address::generate(&env);
    client.admin_add_to_whitelist(&holder);
    assert!(client.is_whitelisted(&holder));
    client.admin_remove_from_whitelist(&holder);
    assert!(!client.is_whitelisted(&holder));
}

#[test]
fn whitelisted_holder_can_bind_once_enforcement_enabled() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    fund(&env, &client, &token, &holder);

    client.admin_set_whitelist_enabled(&true);
    assert!(client.get_whitelist_enabled());

    // Not yet whitelisted: still blocked.
    assert_eq!(
        try_bind(&client, &holder, &token, &InitiatePolicyOptions::test_defaults(&env))
            .unwrap_err(),
        PolicyError::NotWhitelisted
    );

    client.admin_add_to_whitelist(&holder);
    assert!(client.is_whitelisted(&holder));

    // Now whitelisted: bind succeeds.
    assert!(try_bind(&client, &holder, &token, &InitiatePolicyOptions::test_defaults(&env)).is_ok());
}

#[test]
fn deregistering_a_previously_whitelisted_holder_blocks_future_binds() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    fund(&env, &client, &token, &holder);

    client.admin_set_whitelist_enabled(&true);
    client.admin_add_to_whitelist(&holder);
    assert!(try_bind(&client, &holder, &token, &InitiatePolicyOptions::test_defaults(&env)).is_ok());

    // Deregister: subsequent binds (e.g. a second policy) must fail again.
    client.admin_remove_from_whitelist(&holder);
    assert_eq!(
        try_bind(&client, &holder, &token, &InitiatePolicyOptions::test_defaults(&env))
            .unwrap_err(),
        PolicyError::NotWhitelisted
    );
}

#[test]
fn disabling_enforcement_allows_non_whitelisted_holder_to_bind() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    fund(&env, &client, &token, &holder);

    client.admin_set_whitelist_enabled(&true);
    assert_eq!(
        try_bind(&client, &holder, &token, &InitiatePolicyOptions::test_defaults(&env))
            .unwrap_err(),
        PolicyError::NotWhitelisted
    );

    // Admin disables enforcement entirely; whitelist membership no longer matters.
    client.admin_set_whitelist_enabled(&false);
    assert!(!client.get_whitelist_enabled());
    assert!(try_bind(&client, &holder, &token, &InitiatePolicyOptions::test_defaults(&env)).is_ok());
}
