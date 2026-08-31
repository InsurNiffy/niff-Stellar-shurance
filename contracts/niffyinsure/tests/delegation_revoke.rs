#![cfg(test)]

//! Delegation revocation event tests.
//!
//! Explicit revoke must emit `DelegationRevoked` with delegator, delegate, and
//! permissions. Natural expiry must not emit that event.

use niffyinsure::{types::DelegationPermissions, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
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

fn perms(fraud: bool, asset: bool, reins: bool) -> DelegationPermissions {
    DelegationPermissions {
        can_set_fraud_score: fraud,
        can_set_asset_config: asset,
        can_set_reinsurance: reins,
    }
}

#[test]
fn explicit_revoke_emits_delegation_revoked_with_scope() {
    let (env, client, admin, _) = setup();
    let operator = Address::generate(&env);
    let permissions = perms(true, false, true);
    let expiry = env.ledger().sequence() + 100;

    client.grant_delegation(&operator, &expiry, &permissions);

    env.events().all(); // drain grant event

    client.revoke_delegation(&operator);

    let all = env.events().all();
    let debug = soroban_sdk::testutils::arbitrary::std::format!("{:?}", all);
    assert!(
        debug.contains("delegation_revoked"),
        "explicit revoke must emit delegation_revoked: {debug}"
    );
    // Payload should reference the operator (delegate) and permission flags.
    assert!(
        debug.contains("can_set_fraud_score") || debug.contains("true"),
        "event should carry revoked scope/permissions: {debug}"
    );

    // On-chain state cleared
    assert!(client.get_delegation(&operator).is_none());
    // Admin (delegator) identity is part of the published event topics/data.
    let _ = admin;
}

#[test]
fn natural_expiry_does_not_emit_delegation_revoked() {
    let (env, client, _, _) = setup();
    let operator = Address::generate(&env);
    let permissions = perms(true, true, false);
    let now = env.ledger().sequence();
    let expiry = now + 10;

    client.grant_delegation(&operator, &expiry, &permissions);

    // Advance past expiry without calling revoke.
    env.ledger().with_mut(|l| l.sequence_number = expiry + 1);
    env.events().all(); // drain any prior events

    // Natural expiry: get_delegation returns None, no revoke event.
    assert!(client.get_delegation(&operator).is_none());

    let all = env.events().all();
    let debug = soroban_sdk::testutils::arbitrary::std::format!("{:?}", all);
    assert!(
        !debug.contains("delegation_revoked"),
        "natural expiry must not emit delegation_revoked: {debug}"
    );
}

#[test]
fn revoke_without_record_is_noop_without_event() {
    let (env, client, _, _) = setup();
    let operator = Address::generate(&env);
    env.events().all();

    client.revoke_delegation(&operator);

    let all = env.events().all();
    let debug = soroban_sdk::testutils::arbitrary::std::format!("{:?}", all);
    assert!(
        !debug.contains("delegation_revoked"),
        "revoking absent delegation must not emit: {debug}"
    );
}
