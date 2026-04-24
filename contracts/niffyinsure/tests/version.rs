#![cfg(test)]

use niffyinsure::NiffyInsureClient;
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn version_returns_nonempty_semver_string() {
    let env = Env::default();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let v = client.version();
    let v_str = v.to_string();
    assert!(!v_str.is_empty(), "version() must not be empty");
    assert_eq!(
        v_str,
        env!("CARGO_PKG_VERSION"),
        "version() must match Cargo.toml"
    );
}

#[test]
fn version_requires_no_auth_and_no_init() {
    // Contract is not initialised — version() must succeed regardless.
    let env = Env::default();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let _ = client.version(); // must not panic
}

#[test]
fn version_is_idempotent() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);

    let v1 = client.version();
    let v2 = client.version();
    assert_eq!(v1, v2);
}
