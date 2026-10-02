#![cfg(test)]

use niffyinsure::{admin::AdminError, NiffyInsureClient};
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env};

#[test]
fn metadata_fields_are_all_non_empty_after_init() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 42);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);

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
    assert_eq!(meta.admin, admin);
    assert_eq!(meta.token, token);
    assert_eq!(meta.init_ledger, 42);
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
    assert_eq!(client.version().to_string(), env!("CARGO_PKG_VERSION"));
}

#[test]
fn double_init_returns_already_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    let err = client.try_initialize(&admin, &token).err().unwrap().unwrap();
    assert_eq!(err, niffyinsure::InitError::AlreadyInitialized.into());
}

#[test]
fn uninitialized_privileged_entrypoint_returns_typed_error() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let new_admin = Address::generate(&env);
    let err = client.try_propose_admin(&new_admin).err().unwrap().unwrap();
    assert_eq!(err, AdminError::NotInitialized.into());
}
