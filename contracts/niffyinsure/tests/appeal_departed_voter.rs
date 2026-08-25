//! Regression test: `snapshot_appeal_voters` (storage.rs) takes a fresh
//! electorate at appeal-open time. A policy-holder who was eligible for the
//! original claim vote but is removed from the voter registry before
//! `open_appeal` is called must NOT be able to vote in the appeal round.
//!
//! `snapshot_appeal_voters` reads `storage::get_voters`, the same live
//! registry that `remove_voter` mutates, so a removal before `open_appeal`
//! is reflected in the appeal snapshot (not just the original claim
//! snapshot taken at filing time).

#![cfg(test)]

mod common;

use niffyinsure::{types::VoteOption, validate::Error, NiffyInsureClient};
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

#[test]
fn departed_voter_cannot_vote_in_appeal_round() {
    let (env, client, _admin, _token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let leaving_voter = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &leaving_voter, 1_000_000, 500_000);

    let details = String::from_str(&env, "departed voter test");
    let ev = common::empty_evidence(&env);
    let cid = client.file_claim(&v1, &1u32, &100_000i128, &details, &ev, &None);

    // leaving_voter was eligible for the original claim vote (in the
    // registry at filing time).
    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);

    // Removed from the registry BEFORE the appeal is opened.
    client.test_remove_voter(&leaving_voter);

    client.open_appeal(&v1, &cid);

    // Must be rejected by the fresh appeal snapshot, not the original one.
    let err = client
        .try_vote_on_appeal(&leaving_voter, &cid, &VoteOption::Approve)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::NotEligibleVoter);
}
