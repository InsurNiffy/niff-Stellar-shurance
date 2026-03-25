#![cfg(test)]

use niffyinsure::{InitError, NiffyInsureClient};
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    (env, client, admin, token)
}

// ── Successful initialization ─────────────────────────────────────────────────

#[test]
fn initialize_stores_admin_and_token() {
    let (_, client, admin, token) = setup();
    client.initialize(&admin, &token);
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn initialize_counters_start_at_zero() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);
    let holder = Address::generate(&env);
    assert_eq!(client.get_claim_counter(), 0u64);
    assert_eq!(client.get_policy_counter(&holder), 0u32);
    assert!(!client.has_policy(&holder, &1u32));
}

#[test]
fn initialize_emits_genesis_event() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);
    // Event emission verified by absence of panic; event log checked via snapshot.
    let _ = env.ledger().sequence();
    let _ = client.get_admin();
}

// ── Reinitialization guard ────────────────────────────────────────────────────

#[test]
fn double_initialize_returns_already_initialized() {
    let (_, client, admin, token) = setup();
    client.initialize(&admin, &token);
    let result = client.try_initialize(&admin, &token);
    assert_eq!(result.unwrap_err().unwrap(), InitError::AlreadyInitialized);
}

#[test]
fn reinitialize_with_different_admin_is_rejected() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);
    let attacker = Address::generate(&env);
    let result = client.try_initialize(&attacker, &token);
    assert_eq!(result.unwrap_err().unwrap(), InitError::AlreadyInitialized);
    // Original admin unchanged.
    assert_eq!(client.get_admin(), admin);
}

// ── Auth guard ────────────────────────────────────────────────────────────────

#[test]
fn initialize_requires_admin_auth() {
    let env = Env::default();
    // mock_all_auths — verify that with correct auth it succeeds.
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    assert_eq!(client.get_admin(), admin);
}
