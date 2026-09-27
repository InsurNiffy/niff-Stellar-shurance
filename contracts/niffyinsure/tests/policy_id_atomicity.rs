//! Policy ID atomicity: back-to-back policy initiations must produce
//! unique, monotonically increasing IDs.
//!
//! Soroban executes each contract invocation as a single, atomic ledger
//! transaction. Within that invocation frame, all storage reads and writes
//! are isolated from concurrent invocations. This test confirms that the
//! `next_policy_id` counter read-increment-write sequence is safe from races
//! by simulating back-to-back initiations and verifying that every policy
//! receives a distinct ID.

#![cfg(test)]

use niffyinsure::{
    types::{AgeBand, CoverageTier, InitiatePolicyOptions, PolicyType, RegionTier},
    NiffyInsureClient,
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

/// Back-to-back policy initiations on the same holder produce unique,
/// monotonically increasing IDs.
///
/// This test simulates the scenario described in issue #819: two concurrent
/// initiation calls on different ledger slots could theoretically assign the
/// same ID if the read-increment-write were not atomic within a single ledger
/// transaction. Because Soroban guarantees single-invocation atomicity, each
/// call sees a distinct counter value and receives a unique ID.
#[test]
fn back_to_back_initiations_produce_unique_ids() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    mint(&env, &token, &holder, STARTING_BALANCE);
    approve(&env, &token, &holder, &client.address, STARTING_BALANCE);

    let opts = InitiatePolicyOptions::test_defaults(&env);

    // Initiate the first policy.
    let policy1 = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &opts,
    );

    // Advance the ledger so the second call is on a different slot.
    env.ledger()
        .with_mut(|l| l.sequence_number = INITIAL_LEDGER + 1);

    // Initiate the second policy on the same holder.
    let policy2 = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &opts,
    );

    // Both policies must have been assigned IDs.
    assert!(policy1.policy_id > 0, "first policy must have a positive ID");
    assert!(policy2.policy_id > 0, "second policy must have a positive ID");

    // IDs must be distinct.
    assert_ne!(
        policy1.policy_id, policy2.policy_id,
        "back-to-back initiations must produce unique policy IDs"
    );

    // IDs must be monotonically increasing (second > first).
    assert!(
        policy2.policy_id > policy1.policy_id,
        "policy IDs must be monotonically increasing: first={}, second={}",
        policy1.policy_id,
        policy2.policy_id,
    );
}

/// Three back-to-back initiations on the same holder produce three distinct IDs.
#[test]
fn triple_initiation_produces_three_unique_ids() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    mint(&env, &token, &holder, STARTING_BALANCE);
    approve(&env, &token, &holder, &client.address, STARTING_BALANCE);

    let opts = InitiatePolicyOptions::test_defaults(&env);

    let mut ids = Vec::new();
    for i in 0..3 {
        env.ledger()
            .with_mut(|l| l.sequence_number = INITIAL_LEDGER + i);

        let policy = client.initiate_policy(
            &holder,
            &PolicyType::Auto,
            &RegionTier::Medium,
            &AgeBand::Adult,
            &CoverageTier::Standard,
            &80,
            &1_000_000,
            &token,
            &opts,
        );
        ids.push(policy.policy_id);
    }

    // All three IDs must be distinct.
    assert_ne!(ids[0], ids[1], "first and second IDs must differ");
    assert_ne!(ids[1], ids[2], "second and third IDs must differ");
    assert_ne!(ids[0], ids[2], "first and third IDs must differ");

    // IDs must be monotonically increasing.
    assert!(
        ids[0] < ids[1] && ids[1] < ids[2],
        "policy IDs must be monotonically increasing: {:?}",
        ids,
    );
}

/// Initiations on different holders each get their own independent counter,
/// but within each holder the IDs are still unique and monotonically increasing.
#[test]
fn independent_counters_per_holder_are_unique() {
    let (env, client, _admin, token) = setup();
    let holder1 = Address::generate(&env);
    let holder2 = Address::generate(&env);

    mint(&env, &token, &holder1, STARTING_BALANCE);
    approve(&env, &token, &holder1, &client.address, STARTING_BALANCE);
    mint(&env, &token, &holder2, STARTING_BALANCE);
    approve(&env, &token, &holder2, &client.address, STARTING_BALANCE);

    let opts = InitiatePolicyOptions::test_defaults(&env);

    // Initiate one policy for each holder.
    let policy1 = client.initiate_policy(
        &holder1,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &opts,
    );

    env.ledger()
        .with_mut(|l| l.sequence_number = INITIAL_LEDGER + 1);

    let policy2 = client.initiate_policy(
        &holder2,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &opts,
    );

    // Each holder's first policy must have ID 1.
    assert_eq!(
        policy1.policy_id, 1,
        "holder1's first policy must have ID 1"
    );
    assert_eq!(
        policy2.policy_id, 1,
        "holder2's first policy must have ID 1"
    );

    // Initiate a second policy for holder1.
    env.ledger()
        .with_mut(|l| l.sequence_number = INITIAL_LEDGER + 2);

    let policy3 = client.initiate_policy(
        &holder1,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &opts,
    );

    // holder1's second policy must have ID 2 (monotonically increasing).
    assert_eq!(
        policy3.policy_id, 2,
        "holder1's second policy must have ID 2"
    );
}