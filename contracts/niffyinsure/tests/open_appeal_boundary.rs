//! Pins the exact boundary ledger for `open_appeal`'s appeal window check.
//!
//! `open_appeal` checks `now > claim.appeal_open_deadline_ledger`, so the
//! deadline ledger itself is INCLUSIVE: `now == deadline` must still succeed,
//! while `now == deadline + 1` must fail with `AppealWindowClosed`.

#![cfg(test)]

mod common;

use niffyinsure::{types::ClaimStatus, validate::Error, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
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

/// Files a claim, votes it to Rejected, and returns the claim id.
fn file_and_reject(env: &Env, client: &NiffyInsureClient, v1: &Address, v2: &Address) -> u64 {
    let details = String::from_str(env, "boundary test");
    let ev = common::empty_evidence(env);
    let cid = client.file_claim(v1, &1u32, &100_000i128, &details, &ev, &None);

    client.vote_on_claim(v1, &cid, &niffyinsure::types::VoteOption::Reject);
    client.vote_on_claim(v2, &cid, &niffyinsure::types::VoteOption::Reject);

    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);
    cid
}

#[test]
fn open_appeal_succeeds_exactly_at_deadline_ledger() {
    let (env, client, _admin, _token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);

    let cid = file_and_reject(&env, &client, &v1, &v2);
    let deadline = client.get_claim(&cid).appeal_open_deadline_ledger;

    env.ledger().with_mut(|l| l.sequence_number = deadline);

    client.open_appeal(&v1, &cid);

    assert_eq!(client.get_claim(&cid).status, ClaimStatus::UnderAppeal);
}

#[test]
fn open_appeal_fails_one_ledger_past_deadline() {
    let (env, client, _admin, _token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);

    let cid = file_and_reject(&env, &client, &v1, &v2);
    let deadline = client.get_claim(&cid).appeal_open_deadline_ledger;

    env.ledger().with_mut(|l| l.sequence_number = deadline + 1);

    let err = client.try_open_appeal(&v1, &cid).err().unwrap().unwrap();
    assert_eq!(err, Error::AppealWindowClosed);
}
