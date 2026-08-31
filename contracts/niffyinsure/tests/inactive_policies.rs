#![cfg(test)]

use niffyinsure::{types::INACTIVE_POLICIES_PAGE_SIZE_MAX, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

#[test]
fn returns_empty_when_no_policies_exist() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);

    let result = client.get_inactive_policies(&holder, &0u32, &10u32);
    assert_eq!(result.len(), 0u32);
}

#[test]
fn returns_only_inactive_policies() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);

    // policy 1: active (end_ledger far in the future)
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &999_999u32);
    // policy 2: inactive (end_ledger = 1, ledger is now > 1 so it's expired)
    client.test_seed_policy(&holder, &2u32, &1_000_000i128, &1u32);

    // Terminate policy 2 by marking it inactive via end_ledger in the past.
    // The current ledger sequence starts at 0 in tests, but test_seed_policy sets
    // end_ledger=1 which is > 0, so not yet expired by ledger check alone.
    // Advance the ledger so policy 2's end_ledger is in the past.
    env.ledger().set_sequence_number(100);

    let result = client.get_inactive_policies(&holder, &0u32, &10u32);
    // Policy 2 has end_ledger=1, now=100: 100 > 1 → expired → inactive
    assert_eq!(result.len(), 1u32);
    assert_eq!(result.get(0u32).unwrap().policy_id, 2u32);
}

#[test]
fn partial_page_returns_remaining_results() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);

    // Seed 3 inactive policies (end_ledger = 1, advance ledger to 100)
    for i in 1u32..=3 {
        client.test_seed_policy(&holder, &i, &1_000_000i128, &1u32);
    }
    env.ledger().set_sequence_number(100);

    // Request page 1 with page_size=2 → should return only 1 result (policy 3)
    let result = client.get_inactive_policies(&holder, &1u32, &2u32);
    assert_eq!(result.len(), 1u32);
    assert_eq!(result.get(0u32).unwrap().policy_id, 3u32);
}

#[test]
fn over_cap_page_size_reverts() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);

    let result =
        client.try_get_inactive_policies(&holder, &0u32, &(INACTIVE_POLICIES_PAGE_SIZE_MAX + 1));
    assert!(result.is_err());
}

#[test]
fn page_size_at_cap_is_allowed() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);

    let result = client.try_get_inactive_policies(&holder, &0u32, &INACTIVE_POLICIES_PAGE_SIZE_MAX);
    assert!(result.is_ok());
}
