//! Integration tests for `governance-token` feature only.
//! Run: `cargo test -p niffyinsure --features governance-token --test governance_token_feature`

#![cfg(feature = "governance-token")]

use niffyinsure::NiffyInsureClient;
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let client = NiffyInsureClient::new(&env, &contract_id);
    client.initialize(&admin, &token);
    (env, contract_id, admin, token)
}

#[test]
fn gov_runtime_starts_disabled() {
    let (env, contract_id, _, _) = setup();
    let client = NiffyInsureClient::new(&env, &contract_id);
    assert!(!client.gov_token_runtime_enabled());
}

#[test]
fn admin_can_set_runtime_and_stub_address_without_transfers() {
    let (env, contract_id, admin, _) = setup();
    let client = NiffyInsureClient::new(&env, &contract_id);
    let gov_tok = Address::generate(&env);

    client.gov_set_token_address_stub(&admin, &gov_tok);
    assert_eq!(client.gov_token_address(), Some(gov_tok.clone()));

    client.gov_set_token_runtime_enabled(&admin, &true);
    assert!(client.gov_token_runtime_enabled());

    client.gov_set_token_runtime_enabled(&admin, &false);
    assert!(!client.gov_token_runtime_enabled());
}

#[test]
fn activation_event_emitted_on_flag_toggle() {
    use soroban_sdk::testutils::Events;
    let (env, contract_id, admin, _) = setup();
    let client = NiffyInsureClient::new(&env, &contract_id);

    env.events().all(); // clear prior events
    client.gov_set_token_runtime_enabled(&admin, &true);

    let events = env.events().all();
    let _ = contract_id; // used to scope the contract
    let events_debug = soroban_sdk::testutils::arbitrary::std::format!("{:?}", events);
    assert!(
        events_debug.contains("gov_token_activation"),
        "GovernanceTokenActivation event must be emitted on flag toggle"
    );
}
