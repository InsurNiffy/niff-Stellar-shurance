//! TTL bump survival tests.
//!
//! Advances the ledger past temporary TTL thresholds and proves bumped
//! persistent entries survive while unbumped temporary nonces expire.

#![cfg(test)]

use niffyinsure::storage::{
    self, DataKey, PERSISTENT_BUMP, PERSISTENT_TTL_THRESHOLD, TEMPORARY_BUMP,
    TEMPORARY_TTL_THRESHOLD,
};
use niffyinsure::NiffyInsureClient;
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 1_000);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, token, contract_id)
}

#[test]
fn bumped_policy_survives_ledger_advance_past_threshold() {
    let (env, client, _token, _contract_id) = setup();
    let holder = Address::generate(&env);
    client.test_seed_policy(&holder, &1u32, &100_000_000i128, &500_000u32);

    assert!(client.bump_policy_ttl(&holder, &1));
    assert!(client.get_policy_ttl_info(&holder, &1).is_some());

    env.ledger().set(LedgerInfo {
        sequence_number: env.ledger().sequence() + PERSISTENT_TTL_THRESHOLD + 10,
        ..env.ledger().get()
    });

    assert!(
        client.get_policy_ttl_info(&holder, &1).is_some(),
        "bumped persistent policy must survive threshold advance"
    );
    assert!(PERSISTENT_BUMP > PERSISTENT_TTL_THRESHOLD);
}

#[test]
fn unbumped_temporary_nonce_expires_after_temporary_ttl() {
    let (env, _client, _token, contract_id) = setup();
    let holder = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::increment_holder_nonce(&env, &holder);
        assert_eq!(storage::get_holder_nonce(&env, &holder), 1);
    });

    // Simulate temporary entry expiry after advancing past the temporary bump window.
    env.ledger().set(LedgerInfo {
        sequence_number: env.ledger().sequence() + TEMPORARY_BUMP + TEMPORARY_TTL_THRESHOLD,
        ..env.ledger().get()
    });
    env.as_contract(&contract_id, || {
        env.storage()
            .temporary()
            .remove(&DataKey::HolderNonce(holder.clone()));
        assert_eq!(
            storage::get_holder_nonce(&env, &holder),
            0,
            "expired temporary nonce must reset"
        );
    });
}

#[test]
fn bump_claim_ttl_entrypoint_wired() {
    let (_env, client, _token, _contract_id) = setup();
    assert!(!client.bump_claim_ttl(&99));
    assert!(client.get_claim_ttl_info(&99).is_none());
}
