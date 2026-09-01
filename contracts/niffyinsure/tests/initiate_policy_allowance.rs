//! Pre-flight allowance check at `initiate_policy`: a caller who has not
//! approved this contract as a spender (or approved too little) gets a
//! clear `InsufficientAllowance` revert instead of an opaque SEP-41 trap.

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

fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    token::StellarAssetClient::new(env, token).mint(to, &amount);
}

fn approve(env: &Env, token: &Address, holder: &Address, spender: &Address, amount: i128) {
    token::Client::new(env, token).approve(
        holder,
        spender,
        &amount,
        &(env.ledger().sequence() + 10_000),
    );
}

#[test]
fn zero_allowance_reverts_with_insufficient_allowance() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    mint(&env, &token, &holder, STARTING_BALANCE);
    // No approve() call at all — allowance defaults to zero.

    let r = client.try_initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &InitiatePolicyOptions::test_defaults(&env),
    );
    assert_eq!(r.unwrap_err().unwrap(), PolicyError::InsufficientAllowance);
}

#[test]
fn partial_allowance_below_premium_reverts() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    mint(&env, &token, &holder, STARTING_BALANCE);
    // Approve a tiny amount, far below the computed premium for this quote.
    approve(&env, &token, &holder, &client.address, 1);

    let r = client.try_initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &InitiatePolicyOptions::test_defaults(&env),
    );
    assert_eq!(r.unwrap_err().unwrap(), PolicyError::InsufficientAllowance);
}

#[test]
fn sufficient_allowance_succeeds() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    mint(&env, &token, &holder, STARTING_BALANCE);
    approve(&env, &token, &holder, &client.address, STARTING_BALANCE);

    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &InitiatePolicyOptions::test_defaults(&env),
    );
    assert!(policy.premium > 0);
}
