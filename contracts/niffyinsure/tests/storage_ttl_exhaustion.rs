//! Storage TTL exhaustion tests (Issue #1159).
//!
//! Soroban does not provide a direct "expire this TTL now" knob in the test
//! environment. The observable effect of instance-storage TTL expiry is that
//! every key stored in instance storage disappears — the contract behaves as
//! though it was never initialized. We simulate this by using `env.as_contract`
//! to manually remove critical instance-storage keys (Admin, Token) and then
//! asserting that entrypoints return clear typed errors rather than panicking
//! with an unhandled `expect`.
//!
//! ## Recovery path
//! If instance storage expires, the contract can be re-initialized via
//! `initialize()`, which re-populates Admin and Token and restores normal
//! operation. Persistent-tier data (policies, claims, vote records) is
//! unaffected by instance-storage expiry.
//!
//! Run: cargo test --test storage_ttl_exhaustion -- --nocapture

#![cfg(test)]

use niffyinsure::{admin::AdminError, storage::DataKey, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

// ── helpers ──────────────────────────────────────────────────────────────────

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin, token, contract_id)
}

/// Simulate instance-storage TTL expiry by removing the Admin and Token keys.
/// This mirrors what Soroban does when the ledger advances past the TTL: all
/// instance-storage keys for the contract are evicted atomically.
fn expire_instance_storage(env: &Env, contract_id: &Address) {
    env.as_contract(contract_id, || {
        env.storage().instance().remove(&DataKey::Admin);
        env.storage().instance().remove(&DataKey::Token);
    });
}

// ── tests ─────────────────────────────────────────────────────────────────────

/// After instance storage expires, `get_admin()` panics because the `Admin`
/// key no longer exists. The contract does not silently return a zero/garbage
/// address; it fails loudly, which is the correct safe-fail behaviour.
#[test]
#[should_panic]
fn get_admin_panics_when_instance_storage_expired() {
    let (env, client, _admin, _token, contract_id) = setup();
    expire_instance_storage(&env, &contract_id);
    // Must panic — Admin key is gone.
    let _ = client.get_admin();
}

/// `propose_admin` calls `require_admin` internally, which reads the Admin key
/// and calls `require_auth()`. With the Admin key gone, it panics with
/// `AdminError::Unauthorized` rather than a generic unhandled error.
#[test]
fn propose_admin_returns_unauthorized_when_instance_storage_expired() {
    let (env, client, _admin, _token, contract_id) = setup();
    expire_instance_storage(&env, &contract_id);
    let new_admin = Address::generate(&env);

    let err = client.try_propose_admin(&new_admin).err().unwrap().unwrap();
    assert_eq!(err, AdminError::Unauthorized.into());
}

/// `set_allowed_asset` calls `require_admin` internally. Confirms that
/// treasury/parameter-change operations are blocked with a typed error.
#[test]
fn set_allowed_asset_returns_unauthorized_when_instance_storage_expired() {
    let (env, client, _admin, _token, contract_id) = setup();
    expire_instance_storage(&env, &contract_id);
    let asset = Address::generate(&env);

    let err = client
        .try_set_allowed_asset(&asset, &true, &String::from_str(&env, "TKN"), &6u32)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, AdminError::Unauthorized.into());
}

/// After expiry the contract can be re-initialized via `initialize()`.
/// This is the documented recovery path: the new call re-populates Admin and
/// Token, restoring all entrypoints to normal operation.
///
/// Note: `initialize` checks for the Admin key to guard against double-init.
/// When the key is absent (expired), the call is treated as a fresh deployment.
#[test]
fn reinitialize_recovers_after_instance_storage_expiry() {
    let (env, client, _old_admin, _token, contract_id) = setup();
    expire_instance_storage(&env, &contract_id);

    // Re-initialize with a fresh admin and token.
    let new_admin = Address::generate(&env);
    let new_token = Address::generate(&env);
    client.initialize(&new_admin, &new_token);

    // Contract is back to a fully operational state.
    assert_eq!(client.get_admin(), new_admin);

    // Mutating entrypoints work again: propose_admin no longer returns Unauthorized.
    let next_admin = Address::generate(&env);
    client.propose_admin(&next_admin);
}
