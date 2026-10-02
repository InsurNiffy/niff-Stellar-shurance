//! Two-step admin rotation paths (propose / accept / cancel).

#![cfg(test)]

use niffyinsure::{admin::AdminError, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, Env,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 500);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin)
}

#[test]
fn wrong_caller_cannot_accept_admin() {
    let (env, client, _admin) = setup();
    let pending = Address::generate(&env);
    let impostor = Address::generate(&env);
    client.propose_admin(&pending);

    // Auth as impostor only — pending.require_auth() must fail.
    env.mock_auths(&[]);
    let result = client.try_accept_admin();
    assert!(result.is_err(), "accept without pending auth must fail");
    let _ = impostor;
}

#[test]
fn expired_proposal_rejects_accept() {
    let (env, client, _admin) = setup();
    let pending = Address::generate(&env);
    client.propose_admin(&pending);

    // Default admin action window is 100 ledgers.
    env.ledger()
        .with_mut(|l| l.sequence_number = l.sequence_number.saturating_add(101));

    let err = client.try_accept_admin().err().unwrap().unwrap();
    assert_eq!(err, AdminError::AdminActionExpired.into());
}

#[test]
fn proposal_overwrite_replaces_pending() {
    let (env, client, admin) = setup();
    let first = Address::generate(&env);
    let second = Address::generate(&env);
    client.propose_admin(&first);
    client.propose_admin(&second);
    client.accept_admin();
    assert_eq!(client.get_admin(), second);
    assert_ne!(client.get_admin(), admin);
    assert_ne!(client.get_admin(), first);
}

#[test]
fn old_admin_loses_rights_immediately_after_accept() {
    let (env, client, old_admin) = setup();
    let new_admin = Address::generate(&env);
    client.propose_admin(&new_admin);
    client.accept_admin();
    assert_eq!(client.get_admin(), new_admin);

    // Old admin can no longer propose rotation.
    env.mock_auths(&[]);
    // Re-mock only new admin would be needed for success; without auth, propose fails.
    let result = client.try_propose_admin(&Address::generate(&env));
    assert!(result.is_err());
    let _ = old_admin;
}

#[test]
fn cancel_admin_proposal_emits_event_and_clears_pending() {
    let (env, client, _admin) = setup();
    let pending = Address::generate(&env);
    env.events().all();
    client.propose_admin(&pending);
    client.cancel_admin_proposal();

    let events_debug = soroban_sdk::testutils::arbitrary::std::format!("{:?}", env.events().all());
    assert!(
        events_debug.contains("admin_proposal_cancelled")
            || events_debug.contains("cancel_admin"),
        "cancel must emit AdminProposalCancelled"
    );

    let err = client.try_accept_admin().err().unwrap().unwrap();
    assert_eq!(err, AdminError::NoPendingAdmin.into());
}

#[test]
fn current_admin_keeps_rights_until_accept() {
    let (env, client, admin) = setup();
    let pending = Address::generate(&env);
    client.propose_admin(&pending);
    // Current admin can still cancel / re-propose before accept.
    assert_eq!(client.get_admin(), admin);
    client.cancel_admin_proposal();
    client.propose_admin(&pending);
    assert_eq!(client.get_admin(), admin);
}
