//! Issues #1425 / #1426 / #1427 — asset allowlist, ledger accounting, treasury.

#![cfg(test)]

use niffyinsure::{
    types::{AgeBand, CoverageTier, InitiatePolicyOptions, PolicyType, RegionTier},
    AdminError, NiffyInsureClient, PolicyError,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 10_000);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token_addr);
    (env, client, admin, token_addr)
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

// ── #1425 allowlist / bounds / delisting ─────────────────────────────────────

#[test]
fn bind_against_non_allowlisted_asset_fails() {
    let (env, client, _admin, _token) = setup();
    let other = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let holder = Address::generate(&env);
    mint(&env, &other, &holder, 1_000_000_000);
    let err = client
        .try_initiate_policy(
            &holder,
            &PolicyType::Auto,
            &RegionTier::Medium,
            &AgeBand::Adult,
            &CoverageTier::Standard,
            &50u32,
            &1_000_000i128,
            &other,
            &InitiatePolicyOptions::test_defaults(&env),
        )
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, PolicyError::AssetNotAllowed);
}

#[test]
fn claim_bounds_require_positive_and_min_le_max() {
    let (_env, client, _admin, token) = setup();
    assert!(client
        .try_admin_set_asset_claim_bounds(&token, &0i128, &100i128)
        .is_err());
    assert!(client
        .try_admin_set_asset_claim_bounds(&token, &-1i128, &100i128)
        .is_err());
    assert!(client
        .try_admin_set_asset_claim_bounds(&token, &200i128, &100i128)
        .is_err());
    assert!(client
        .try_admin_set_asset_claim_bounds(&token, &10i128, &100i128)
        .is_ok());
    let bounds = client.get_asset_claim_bounds(&token).unwrap();
    assert_eq!(bounds.min_claim_amount, 10);
    assert_eq!(bounds.max_claim_amount, 100);
}

#[test]
fn delisting_blocks_new_bind_but_existing_policy_survives() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    mint(&env, &token, &holder, 50_000_000_000);
    approve(&env, &token, &holder, &client.address, 50_000_000_000);

    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &50u32,
        &1_000_000i128,
        &token,
        &InitiatePolicyOptions::test_defaults(&env),
    );
    assert!(policy.is_active);

    client.set_allowed_asset(&token, &false, &String::from_str(&env, ""), &0u32);
    assert!(!client.is_allowed_asset(&token));

    let other_holder = Address::generate(&env);
    mint(&env, &token, &other_holder, 50_000_000_000);
    approve(
        &env,
        &token,
        &other_holder,
        &client.address,
        50_000_000_000,
    );
    let err = client
        .try_initiate_policy(
            &other_holder,
            &PolicyType::Auto,
            &RegionTier::Medium,
            &AgeBand::Adult,
            &CoverageTier::Standard,
            &50u32,
            &1_000_000i128,
            &token,
            &InitiatePolicyOptions::test_defaults(&env),
        )
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, PolicyError::AssetNotAllowed);

    let existing = client.get_policy(&holder, &policy.policy_id).expect("policy exists");
    assert!(existing.is_active);
    assert_eq!(existing.asset, token);
}

// ── #1426 ledger accounting ──────────────────────────────────────────────────

#[test]
fn ledger_counters_consistent_across_deposit_and_sweep() {
    let (env, client, _admin, token) = setup();
    let depositor = Address::generate(&env);
    client.set_authorized_depositor(&depositor, &true);
    mint(&env, &token, &depositor, 1_000_000);

    client.deposit_treasury(&depositor, &400_000i128, &token);
    assert_eq!(client.get_ledger_treasury_balance(&token), 400_000);
    assert_eq!(client.get_total_premiums(&token), 0);
    assert_eq!(client.get_reserved_coverage(&token), 0);
    assert!(token::Client::new(&env, &token).balance(&client.address) >= 400_000);

    let recipient = Address::generate(&env);
    client.set_allowed_payout_recipient(&recipient, &true);
    client.admin_set_max_sweep_per_ledger(&1_000_000i128);
    assert!(client
        .try_admin_sweep(&token, &recipient, &100_000i128)
        .is_ok());
    assert_eq!(client.get_ledger_treasury_balance(&token), 300_000);
}

#[test]
fn invariant_token_balance_ge_treasury_balance_after_ops() {
    let (env, client, _admin, token) = setup();
    let depositor = Address::generate(&env);
    client.set_authorized_depositor(&depositor, &true);
    mint(&env, &token, &depositor, 5_000_000);

    for amount in [100_000i128, 250_000, 50_000, 1_000_000] {
        client.deposit_treasury(&depositor, &amount, &token);
        let book = client.get_ledger_treasury_balance(&token);
        let bal = token::Client::new(&env, &token).balance(&client.address);
        assert!(
            bal >= book,
            "invariant violated: token_balance {bal} < treasury_balance {book}"
        );
    }
}

// ── #1427 treasury depositors / sweep ────────────────────────────────────────

#[test]
fn unauthorized_deposit_fails() {
    let (env, client, _admin, token) = setup();
    let stranger = Address::generate(&env);
    mint(&env, &token, &stranger, 1_000_000);
    assert!(client
        .try_deposit_treasury(&stranger, &100i128, &token)
        .is_err());
}

#[test]
fn admin_sweep_cap_exceeded_fails() {
    let (env, client, _admin, token) = setup();
    let depositor = Address::generate(&env);
    let to = Address::generate(&env);
    client.set_authorized_depositor(&depositor, &true);
    client.set_allowed_payout_recipient(&to, &true);
    mint(&env, &token, &depositor, 2_000_000);
    client.deposit_treasury(&depositor, &1_000_000i128, &token);
    client.admin_set_max_sweep_per_ledger(&100_000i128);
    assert!(client.try_admin_sweep(&token, &to, &100_001i128).is_err());
}

#[test]
fn admin_sweep_under_reserve_fails() {
    let (env, client, _admin, token) = setup();
    let depositor = Address::generate(&env);
    let holder = Address::generate(&env);
    let to = Address::generate(&env);
    client.set_authorized_depositor(&depositor, &true);
    client.set_allowed_payout_recipient(&to, &true);
    mint(&env, &token, &depositor, 10_000_000);
    mint(&env, &token, &holder, 50_000_000_000);
    approve(&env, &token, &holder, &client.address, 50_000_000_000);

    client.deposit_treasury(&depositor, &5_000_000i128, &token);
    let _policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &50u32,
        &1_000_000i128,
        &token,
        &InitiatePolicyOptions::test_defaults(&env),
    );
    let reserved = client.get_reserved_coverage(&token);
    assert!(reserved > 0);
    let book = client.get_ledger_treasury_balance(&token);
    let free = book - reserved;
    client.admin_set_max_sweep_per_ledger(&(free + 1_000_000));
    let err = client
        .try_admin_sweep(&token, &to, &(free + 1))
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, AdminError::ProtectedBalanceViolation);
}

#[test]
fn admin_sweep_valid_succeeds() {
    let (env, client, _admin, token) = setup();
    let depositor = Address::generate(&env);
    let to = Address::generate(&env);
    client.set_authorized_depositor(&depositor, &true);
    client.set_allowed_payout_recipient(&to, &true);
    mint(&env, &token, &depositor, 1_000_000);
    client.deposit_treasury(&depositor, &500_000i128, &token);
    client.admin_set_max_sweep_per_ledger(&500_000i128);
    assert!(client.try_admin_sweep(&token, &to, &200_000i128).is_ok());
    assert_eq!(token::Client::new(&env, &token).balance(&to), 200_000);
}
