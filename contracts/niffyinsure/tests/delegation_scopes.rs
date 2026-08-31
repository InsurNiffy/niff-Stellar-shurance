//! Delegation scope enumeration tests (Issue #1149).

#![cfg(test)]

use niffyinsure::{
    types::{ActiveDelegatedScope, DelegatedScopeKind, DelegationPermissions},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 1_000);
    let cid = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &cid);
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

#[test]
fn list_scopes_empty_when_no_delegation() {
    let (env, client, _) = setup();
    let operator = Address::generate(&env);
    let scopes = client.list_active_delegated_scopes(&operator, &0u32, &20u32);
    assert_eq!(scopes.len(), 0);
}

#[test]
fn list_scopes_one_delegation() {
    let (env, client, _) = setup();
    let operator = Address::generate(&env);
    client.grant_delegation(&operator, &5_000u32, &perms(true, false, false));

    let scopes = client.list_active_delegated_scopes(&operator, &0u32, &20u32);
    assert_eq!(scopes.len(), 1);
    let s: ActiveDelegatedScope = scopes.get(0).unwrap();
    assert_eq!(s.scope, DelegatedScopeKind::SetFraudScore);
    assert_eq!(s.expiry_ledger, 5_000);
}

#[test]
fn list_scopes_multiple_delegations() {
    let (env, client, _) = setup();
    let operator = Address::generate(&env);
    client.grant_delegation(&operator, &5_000u32, &perms(true, true, true));

    let scopes = client.list_active_delegated_scopes(&operator, &0u32, &20u32);
    assert_eq!(scopes.len(), 3);
    assert_eq!(
        scopes.get(0).unwrap().scope,
        DelegatedScopeKind::SetFraudScore
    );
    assert_eq!(
        scopes.get(1).unwrap().scope,
        DelegatedScopeKind::SetAssetConfig
    );
    assert_eq!(
        scopes.get(2).unwrap().scope,
        DelegatedScopeKind::SetReinsurance
    );
}

#[test]
fn list_scopes_excludes_expired() {
    let (env, client, _) = setup();
    let operator = Address::generate(&env);
    client.grant_delegation(&operator, &1_500u32, &perms(true, true, false));

    env.ledger().with_mut(|l| l.sequence_number = 1_501);
    let scopes = client.list_active_delegated_scopes(&operator, &0u32, &20u32);
    assert_eq!(scopes.len(), 0);
}

#[test]
fn list_scopes_excludes_revoked() {
    let (env, client, _) = setup();
    let operator = Address::generate(&env);
    client.grant_delegation(&operator, &5_000u32, &perms(true, true, false));
    client.revoke_delegation(&operator);

    let scopes = client.list_active_delegated_scopes(&operator, &0u32, &20u32);
    assert_eq!(scopes.len(), 0);
}

#[test]
fn list_scopes_is_paginated() {
    let (env, client, _) = setup();
    let operator = Address::generate(&env);
    client.grant_delegation(&operator, &5_000u32, &perms(true, true, true));

    let page1 = client.list_active_delegated_scopes(&operator, &0u32, &2u32);
    assert_eq!(page1.len(), 2);
    let page2 = client.list_active_delegated_scopes(&operator, &2u32, &2u32);
    assert_eq!(page2.len(), 1);
    assert_eq!(
        page2.get(0).unwrap().scope,
        DelegatedScopeKind::SetReinsurance
    );
}

#[test]
fn list_scopes_does_not_mutate_state() {
    let (env, client, _) = setup();
    let operator = Address::generate(&env);
    client.grant_delegation(&operator, &5_000u32, &perms(true, false, false));

    let before = client.get_delegation(&operator).unwrap();
    let _ = client.list_active_delegated_scopes(&operator, &0u32, &20u32);
    let after = client.get_delegation(&operator).unwrap();
    assert_eq!(before, after);
}
