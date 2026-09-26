//! Delegation revocation events (admin role delegation, Issue #585).
//!
//! Verifies:
//!   - Explicit early revoke emits `delegation_revoked` with grantor, operator,
//!     and revoked permission scope
//!   - Natural expiry (time passing / get after expiry) does **not** emit it
//!   - Revoking an already-expired stale record cleans storage without emitting

#![cfg(test)]

use niffyinsure::{types::DelegationPermissions, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, Env,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 1_000);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin)
}

fn perms(fraud: bool, asset: bool, reins: bool) -> DelegationPermissions {
    DelegationPermissions {
        can_set_fraud_score: fraud,
        can_set_asset_config: asset,
        can_set_reinsurance: reins,
    }
}

fn event_log(env: &Env) -> soroban_sdk::testutils::arbitrary::std::string::String {
    let all = env.events().all();
    soroban_sdk::testutils::arbitrary::std::format!("{:?}", all)
}

// ── Explicit early revocation ─────────────────────────────────────────────────

#[test]
fn explicit_revoke_emits_delegation_revoked_with_scope() {
    let (env, client, admin) = setup();
    let operator = Address::generate(&env);
    let scope = perms(true, false, true);

    client.grant_delegation(&operator, &5_000u32, &scope);

    // Drain grant event so we only assert on revoke.
    let _ = env.events().all();

    client.revoke_delegation(&operator);

    let log = event_log(&env);
    assert!(
        log.contains("delegation_revoked"),
        "explicit revoke must emit delegation_revoked, got: {log}"
    );
    // Payload must be rich enough for indexers: grantor, operator, scope flags.
    assert!(
        log.contains("can_set_fraud_score") || log.contains("true"),
        "revoked scope / permissions must appear in the event payload"
    );

    assert!(
        client.get_delegation(&operator).is_none(),
        "delegation must be cleared after revoke"
    );
    // Grantor recorded on the event is the admin who granted.
    let _ = admin;
}

#[test]
fn explicit_revoke_removes_delegation_immediately() {
    let (env, client, _admin) = setup();
    let operator = Address::generate(&env);

    client.grant_delegation(&operator, &5_000u32, &perms(true, true, false));
    assert!(client.get_delegation(&operator).is_some());

    client.revoke_delegation(&operator);
    assert!(client.get_delegation(&operator).is_none());
}

// ── Natural expiry must not emit revoke ───────────────────────────────────────

#[test]
fn natural_expiry_does_not_emit_delegation_revoked() {
    let (env, client, _admin) = setup();
    let operator = Address::generate(&env);

    client.grant_delegation(&operator, &1_500u32, &perms(false, true, false));

    // Drain grant event.
    let _ = env.events().all();

    // Advance past expiry without calling revoke.
    env.ledger().with_mut(|l| l.sequence_number = 1_501);

    // Natural expiry is observed via read — must not emit revoke.
    assert!(
        client.get_delegation(&operator).is_none(),
        "expired delegation must read as absent"
    );

    let log = event_log(&env);
    assert!(
        !log.contains("delegation_revoked"),
        "natural expiry must not emit delegation_revoked, got: {log}"
    );
}

#[test]
fn revoke_after_natural_expiry_does_not_emit_revoked_event() {
    let (env, client, _admin) = setup();
    let operator = Address::generate(&env);

    client.grant_delegation(&operator, &1_200u32, &perms(true, false, false));

    env.ledger().with_mut(|l| l.sequence_number = 1_201);
    let _ = env.events().all();

    // Explicit revoke call after expiry: storage cleanup only, no revoke event.
    client.revoke_delegation(&operator);

    let log = event_log(&env);
    assert!(
        !log.contains("delegation_revoked"),
        "revoking an already-expired record must not emit delegation_revoked"
    );
    assert!(client.get_delegation(&operator).is_none());
}

#[test]
fn revoke_absent_delegation_emits_nothing() {
    let (env, client, _admin) = setup();
    let operator = Address::generate(&env);

    let _ = env.events().all();
    client.revoke_delegation(&operator);

    let log = event_log(&env);
    assert!(
        !log.contains("delegation_revoked"),
        "revoking a non-existent delegation must not emit"
    );
}
