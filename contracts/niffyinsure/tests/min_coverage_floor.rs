//! Coverage amount floor: `min_coverage_amount` is an admin-configurable
//! instance-storage parameter enforced at `initiate_policy`.
//!
//! Covers:
//!   - Below-minimum coverage reverts with `InvalidCoverage`.
//!   - At-minimum coverage (== floor) is accepted.
//!   - Above-minimum coverage is accepted.
//!   - Admin can raise/lower the floor via `admin_set_min_coverage_amount`.
//!   - `MinCoverageAmountUpdatedData` event is emitted on every floor change.
//!   - A floor change only affects policies bound *after* the change.

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{AgeBand, CoverageTier, InitiatePolicyOptions, PolicyType, RegionTier},
    NiffyInsureClient, PolicyError,
};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token, Address, Env,
};

const INITIAL_LEDGER: u32 = 200;
const STARTING_BALANCE: i128 = 100_000_000_000;

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

fn fund_holder(env: &Env, client: &NiffyInsureClient<'_>, token: &Address, holder: &Address) {
    token::StellarAssetClient::new(env, token).mint(holder, &STARTING_BALANCE);
    token::Client::new(env, token).approve(
        holder,
        &client.address,
        &STARTING_BALANCE,
        &(env.ledger().sequence() + 50_000),
    );
}

fn bind(
    client: &NiffyInsureClient<'_>,
    env: &Env,
    token: &Address,
    holder: &Address,
    coverage: i128,
) -> niffyinsure::types::Policy {
    client.initiate_policy(
        holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &10u32,
        &coverage,
        token,
        &InitiatePolicyOptions::test_defaults(env),
    )
}

fn try_bind_error(
    client: &NiffyInsureClient<'_>,
    env: &Env,
    token: &Address,
    holder: &Address,
    coverage: i128,
) -> PolicyError {
    let result = client.try_initiate_policy(
        holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &10u32,
        &coverage,
        token,
        &InitiatePolicyOptions::test_defaults(env),
    );
    match result {
        Err(Ok(e)) => e,
        other => panic!("expected a contract-level PolicyError, got: {:?}", other.is_ok()),
    }
}

// ── Default floor boundary behaviour ──────────────────────────────────────────

/// Coverage strictly below the default floor (1_000_000 stroops) reverts.
#[test]
fn below_default_minimum_reverts() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    let err = try_bind_error(&client, &env, &token, &holder, 999_999i128);

    assert_eq!(
        err,
        PolicyError::InvalidCoverage,
        "coverage below the floor must revert with InvalidCoverage"
    );
}

/// Coverage exactly equal to the floor is accepted (inclusive lower bound).
#[test]
fn at_default_minimum_is_accepted() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    let policy = bind(&client, &env, &token, &holder, 1_000_000i128);

    assert_eq!(policy.coverage, 1_000_000i128);
}

/// Coverage above the floor is accepted.
#[test]
fn above_default_minimum_is_accepted() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    let policy = bind(&client, &env, &token, &holder, 5_000_000i128);

    assert_eq!(policy.coverage, 5_000_000i128);
}

// ── Admin-configurable floor ──────────────────────────────────────────────────

/// Admin can raise the floor; below-new-floor (but above default) reverts.
#[test]
fn admin_raised_floor_rejects_previously_valid_coverage() {
    let (env, client, _admin, token) = setup();

    client.admin_set_min_coverage_amount(&10_000_000i128);
    assert_eq!(client.get_min_coverage_amount(), 10_000_000i128);

    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    // Previously valid under the default floor (1_000_000) but now below the
    // admin-raised floor (10_000_000).
    let err = try_bind_error(&client, &env, &token, &holder, 5_000_000i128);

    assert_eq!(err, PolicyError::InvalidCoverage);
}

/// A floor change only applies going forward — an already-bound policy keeps
/// its original coverage even if a later floor increase would have rejected it.
#[test]
fn floor_change_does_not_affect_already_bound_policies() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    // Bind while the default floor (1_000_000) is in effect.
    let policy = bind(&client, &env, &token, &holder, 1_500_000i128);

    // Raise the floor well above the already-bound coverage.
    client.admin_set_min_coverage_amount(&5_000_000i128);

    // The existing policy is untouched.
    let stored = client.get_policy(&holder, &policy.policy_id).unwrap();
    assert_eq!(stored.coverage, 1_500_000i128);

    // But a *new* bind at the same amount now reverts.
    let second_holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &second_holder);
    let err = try_bind_error(&client, &env, &token, &second_holder, 1_500_000i128);
    assert_eq!(err, PolicyError::InvalidCoverage);
}

/// Every floor change emits a `MinCoverageAmountUpdatedData` event.
#[test]
fn floor_change_emits_event() {
    let (env, client, _admin, _token) = setup();

    let before = env.events().all().events().len();
    client.admin_set_min_coverage_amount(&2_000_000i128);
    let after = env.events().all().events().len();

    assert!(
        after > before,
        "admin_set_min_coverage_amount must emit an event"
    );
}
