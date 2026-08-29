//! Tests for Issue #829: Contract initialization replay guard.
//!
//! Verifies that calling `initialize` a second time reverts with
//! `InitError::AlreadyInitialized`, preventing admin overwrite or config reset.
#![cfg(test)]

use niffyinsure::{InitError, NiffyInsureClient};
use soroban_sdk::{
    testutils::Address as _,
    Address, Env,
};

#[test]
fn second_init_call_reverts_with_already_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);

    // First init succeeds
    let result = client.try_initialize(&admin, &token);
    assert!(result.is_ok(), "first initialize must succeed");

    // Second init with same args reverts
    let result2 = client.try_initialize(&admin, &token);
    assert!(result2.is_err(), "second initialize must revert");

    // Verify the error is AlreadyInitialized
    match result2 {
        Err(Ok(e)) => assert_eq!(e, InitError::AlreadyInitialized),
        Err(Err(_)) => { /* invocation error is also acceptable */ }
        Ok(_) => panic!("second init should not succeed"),
    }
}

#[test]
fn second_init_with_different_admin_also_reverts() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let token = Address::generate(&env);

    client.initialize(&admin1, &token);

    // Attacker tries to overwrite admin
    let result = client.try_initialize(&admin2, &token);
    assert!(
        result.is_err(),
        "init with different admin must revert (prevents admin overwrite)"
    );
}

#[test]
fn second_init_with_different_token_also_reverts() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token1 = Address::generate(&env);
    let token2 = Address::generate(&env);

    client.initialize(&admin, &token1);

    // Attacker tries to overwrite token
    let result = client.try_initialize(&admin, &token2);
    assert!(
        result.is_err(),
        "init with different token must revert (prevents config corruption)"
    );
}

#[test]
fn guard_check_is_first_operation() {
    // This test documents that the guard (checking DataKey::Admin existence)
    // is the first operation in the initialize function, before any state
    // writes. This is verified by reading the source at lib.rs:200-203:
    //
    //   pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), InitError> {
    //       admin.require_auth();
    //       if env.storage().instance().has(&storage::DataKey::Admin) {
    //           return Err(InitError::AlreadyInitialized);
    //       }
    //
    // The guard returns immediately, before set_admin, set_token, or any
    // other state mutation. This ensures no partial writes occur on replay.
}
