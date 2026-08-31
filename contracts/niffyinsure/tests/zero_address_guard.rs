//! Zero-address guard tests (Issue #785).
//!
//! Verifies that every address-accepting entrypoint rejects the Stellar
//! all-zero account (`GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF`)
//! with `ZeroAddress` / `InvalidAddress`.

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{AgeBand, CoverageTier, InitiatePolicyOptions, PolicyType, RegionTier},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};

const ZERO_STRKEY: &str = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const INITIAL_LEDGER: u32 = 200;
const STARTING_BALANCE: i128 = 100_000_000_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger()
        .with_mut(|l| l.sequence_number = INITIAL_LEDGER);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

fn zero_address(env: &Env) -> Address {
    Address::from_string(&String::from_str(env, ZERO_STRKEY))
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

// ── initiate_policy: zero holder ─────────────────────────────────────────────

#[test]
fn initiate_policy_rejects_zero_holder() {
    let (env, client, _, token) = setup();
    let zero = zero_address(&env);
    fund(&env, &client, &token, &zero);

    let err = client
        .try_initiate_policy(
            &zero,
            &PolicyType::Auto,
            &RegionTier::Low,
            &AgeBand::Adult,
            &CoverageTier::Standard,
            &10u32,
            &1_000_000i128,
            &token,
            &InitiatePolicyOptions::test_defaults(&env),
        )
        .err()
        .unwrap()
        .unwrap();

    assert_eq!(err, niffyinsure::PolicyError::ZeroAddress.into());
}

// ── initiate_policy: zero beneficiary ────────────────────────────────────────

#[test]
fn initiate_policy_rejects_zero_beneficiary() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    fund(&env, &client, &token, &holder);

    let err = client
        .try_initiate_policy(
            &holder,
            &PolicyType::Auto,
            &RegionTier::Low,
            &AgeBand::Adult,
            &CoverageTier::Standard,
            &10u32,
            &1_000_000i128,
            &token,
            &InitiatePolicyOptions {
                beneficiary: Some(zero_address(&env)),
                ..InitiatePolicyOptions::test_defaults(&env)
            },
        )
        .err()
        .unwrap()
        .unwrap();

    assert_eq!(err, niffyinsure::PolicyError::ZeroAddress.into());
}

// ── set_beneficiary: zero beneficiary ────────────────────────────────────────

#[test]
fn set_beneficiary_rejects_zero_address() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    fund(&env, &client, &token, &holder);

    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &10u32,
        &1_000_000i128,
        &token,
        &InitiatePolicyOptions::test_defaults(&env),
    );

    let err = client
        .try_set_beneficiary(&holder, &policy.policy_id, &Some(zero_address(&env)))
        .err()
        .unwrap()
        .unwrap();

    assert_eq!(err, niffyinsure::PolicyError::ZeroAddress.into());
}

// ── propose_admin: zero new_admin ────────────────────────────────────────────

#[test]
fn propose_admin_rejects_zero_address() {
    let (env, client, _, _) = setup();
    let zero = zero_address(&env);

    let err = client.try_propose_admin(&zero).err().unwrap().unwrap();

    assert_eq!(err, niffyinsure::AdminError::InvalidAddress.into());
}

// ── non-zero addresses are accepted ──────────────────────────────────────────

#[test]
fn initiate_policy_accepts_non_zero_holder() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    fund(&env, &client, &token, &holder);

    // Should not panic — just assert it returns a valid policy.
    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &10u32,
        &1_000_000i128,
        &token,
        &InitiatePolicyOptions::test_defaults(&env),
    );
    assert_eq!(policy.holder, holder);
}
