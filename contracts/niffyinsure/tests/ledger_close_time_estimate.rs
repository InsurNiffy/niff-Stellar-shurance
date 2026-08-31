//! Tests for Issue #842: Ledger close time estimation helper.

#![cfg(test)]

use niffyinsure::NiffyInsureClient;
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin)
}

#[test]
fn default_estimate_is_five() {
    let (_env, client, _admin) = setup();
    // Default should be 5 (SECS_PER_LEDGER constant) when unset
    assert_eq!(client.get_ledger_close_time_estimate(), 5u32);
}

#[test]
fn admin_can_update_estimate() {
    let (_env, client, _admin) = setup();
    client.admin_set_ledger_close_secs(&7u32);
    assert_eq!(client.get_ledger_close_time_estimate(), 7u32);
}

#[test]
fn get_estimate_is_read_only_no_state_mutation() {
    let (_env, client, _admin) = setup();
    // Calling get multiple times returns the same value without side effects
    assert_eq!(client.get_ledger_close_time_estimate(), 5u32);
    assert_eq!(client.get_ledger_close_time_estimate(), 5u32);
}

#[test]
fn estimate_zero_is_rejected() {
    let (_env, client, _admin) = setup();
    assert!(client.try_admin_set_ledger_close_secs(&0u32).is_err());
}

#[test]
fn estimate_above_thirty_is_rejected() {
    let (_env, client, _admin) = setup();
    assert!(client.try_admin_set_ledger_close_secs(&31u32).is_err());
}

#[test]
fn estimate_at_boundary_is_accepted() {
    let (_env, client, _admin) = setup();
    client.admin_set_ledger_close_secs(&1u32);
    assert_eq!(client.get_ledger_close_time_estimate(), 1u32);
    client.admin_set_ledger_close_secs(&30u32);
    assert_eq!(client.get_ledger_close_time_estimate(), 30u32);
}
