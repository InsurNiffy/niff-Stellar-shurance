//! Governance: configurable voting duration in instance storage, per-claim deadlines at filing.

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{VoteOption, MAX_VOTING_DURATION_LEDGERS, MIN_VOTING_DURATION_LEDGERS},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 10_000);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

fn seed(client: &NiffyInsureClient, holder: &Address, coverage: i128, end_ledger: u32) {
    client.test_seed_policy(holder, &1u32, &coverage, &end_ledger);
}

fn file_claim(client: &NiffyInsureClient, holder: &Address, amount: i128, env: &Env) -> u64 {
    let details = String::from_str(env, "duration test");
    let ev = common::empty_evidence(env);
    client.file_claim(holder, &1u32, &amount, &details, &ev)
}

#[test]
fn vote_succeeds_at_voting_deadline_ledger() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 500_000);
    let cid = file_claim(&client, &holder, 100_000, &env);
    let claim = client.get_claim(&cid);
    env.ledger()
        .with_mut(|l| l.sequence_number = claim.voting_deadline_ledger);
    let _status = client
        .try_vote_on_claim(&holder, &cid, &VoteOption::Approve)
        .expect("vote at deadline ledger must succeed");
}

#[test]
fn vote_rejected_one_ledger_after_deadline() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 500_000);
    let cid = file_claim(&client, &holder, 100_000, &env);
    let claim = client.get_claim(&cid);
    env.ledger().with_mut(|l| {
        l.sequence_number = claim.voting_deadline_ledger.saturating_add(1);
    });
    assert!(client
        .try_vote_on_claim(&holder, &cid, &VoteOption::Approve)
        .is_err());
}

#[test]
fn admin_duration_change_does_not_affect_existing_claim_deadline() {
    let (env, client, _admin, _) = setup();
    let h1 = Address::generate(&env);
    let h2 = Address::generate(&env);
    seed(&client, &h1, 1_000_000, 500_000);
    seed(&client, &h2, 1_000_000, 500_000);
    let cid1 = file_claim(&client, &h1, 100_000, &env);
    let before = client.get_claim(&cid1).voting_deadline_ledger;

    assert!(client
        .try_admin_set_vote_duration_ledgers(&MIN_VOTING_DURATION_LEDGERS)
        .is_ok());

    let after = client.get_claim(&cid1).voting_deadline_ledger;
    assert_eq!(after, before, "stored per-claim deadline must be immutable");

    let cid2 = file_claim(&client, &h2, 50_000, &env);
    let c2 = client.get_claim(&cid2);
    assert_eq!(
        c2.voting_deadline_ledger,
        c2.filed_at.saturating_add(MIN_VOTING_DURATION_LEDGERS)
    );
}

#[test]
fn admin_set_duration_out_of_bounds_fails() {
    let (_env, client, _, _) = setup();
    assert!(client
        .try_admin_set_vote_duration_ledgers(&(MIN_VOTING_DURATION_LEDGERS - 1))
        .is_err());
    assert!(client
        .try_admin_set_vote_duration_ledgers(&(MAX_VOTING_DURATION_LEDGERS + 1))
        .is_err());
}

#[test]
fn get_vote_duration_ledgers_reflects_admin_set() {
    let (_env, client, _, _) = setup();
    let new_dur = MIN_VOTING_DURATION_LEDGERS + 1_000;
    assert_ne!(new_dur, client.get_vote_duration_ledgers());
    assert!(client.try_admin_set_vote_duration_ledgers(&new_dur).is_ok());
    assert_eq!(client.get_vote_duration_ledgers(), new_dur);
}
