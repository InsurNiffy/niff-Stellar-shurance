#![cfg(test)]

use niffyinsure::NiffyInsureClient;
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn metadata_fields_are_all_non_empty() {
    let env = Env::default();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let meta = client.get_contract_metadata();
    assert!(!meta.name.to_string().is_empty(), "name must not be empty");
    assert!(
        !meta.version.to_string().is_empty(),
        "version must not be empty"
    );
    assert!(
        !meta.network_passphrase_hint.to_string().is_empty(),
        "network_passphrase_hint must not be empty"
    );
}

#[test]
fn metadata_requires_no_auth_and_no_init() {
    let env = Env::default();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    // Must succeed without initialization or auth.
    let _ = client.get_contract_metadata();
}

#[test]
fn metadata_version_matches_cargo_pkg_version() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);

    let meta = client.get_contract_metadata();
    assert_eq!(
        meta.version.to_string(),
        env!("CARGO_PKG_VERSION"),
        "version must match Cargo.toml"
    );
}
