//! Tests for Issue #841: Claim escalation entrypoint.

#![cfg(test)]

mod common;

use niffyinsure::{types::ClaimStatus, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin)
}

fn seed_and_file(env: &Env, client: &NiffyInsureClient, holder: &Address) -> u64 {
    client.test_seed_policy(holder, &1u32, &1_000_000i128, &10_000u32);
    let details = String::from_str(env, "test claim");
    let ev = common::empty_evidence(env);
    client.file_claim(holder, &1u32, &500_000i128, &details, &ev, &None)
}

#[test]
fn escalate_claim_valid() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);
    let claim_id = seed_and_file(&env, &client, &holder);

    // current ledger = 100, voting deadline = 100 + VOTE_WINDOW_LEDGERS (~120_960)
    let new_deadline = 100u32 + 1000; // in the future, earlier than current deadline

    client.escalate_claim(&claim_id, &new_deadline);

    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.voting_deadline_ledger, new_deadline);
    assert_eq!(claim.status, ClaimStatus::Processing);
}

#[test]
fn escalate_claim_past_deadline_reverts() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);
    let claim_id = seed_and_file(&env, &client, &holder);

    // new_deadline <= now (100) — must revert
    let result = client.try_escalate_claim(&claim_id, &99u32);
    assert!(result.is_err());
}

#[test]
fn escalate_claim_not_earlier_than_current_reverts() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);
    let claim_id = seed_and_file(&env, &client, &holder);

    // current deadline = 100 + 120_960; passing same value is not strictly earlier
    let current_deadline = 100u32 + 120_960;
    let result = client.try_escalate_claim(&claim_id, &current_deadline);
    assert!(result.is_err());
}

#[test]
fn escalate_non_processing_claim_reverts() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);
    let claim_id = seed_and_file(&env, &client, &holder);

    // Withdraw so status is no longer Processing
    client.withdraw_claim(&holder, &claim_id);

    let result = client.try_escalate_claim(&claim_id, &(100u32 + 1000));
    assert!(result.is_err());
}
