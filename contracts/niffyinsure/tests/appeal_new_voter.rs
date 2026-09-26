//! Regression test: the `open_appeal` doc comment states that new
//! policy-holders can participate in the appeal vote because a fresh voter
//! snapshot is taken at appeal-open time (see `storage::snapshot_appeal_voters`).
//! This was previously untested.

#![cfg(test)]

mod common;

use niffyinsure::{types::VoteOption, NiffyInsureClient};
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

/// A voter registered after the original claim vote, but before `open_appeal`
/// is called, must be included in the appeal-round electorate and be able to
/// cast a vote via `vote_on_appeal`.
///
/// Registration timing here (`test_seed_policy` calling `storage::add_voter`)
/// stands in for `batch_register_voter`: both mutate the same live voter
/// registry that `snapshot_appeal_voters` reads at appeal-open time, so the
/// timing behavior asserted here holds for either registration path.
#[test]
fn newly_registered_holder_can_vote_in_appeal_round() {
    let (env, client, _admin, _token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);

    let details = String::from_str(&env, "new voter test");
    let ev = common::empty_evidence(&env);
    let cid = client.file_claim(&v1, &1u32, &100_000i128, &details, &ev, &None);

    // Original vote: majority reject.
    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);

    // A new policy-holder registers AFTER the original vote but BEFORE the
    // appeal is opened.
    let late_voter = Address::generate(&env);
    seed(&client, &late_voter, 1_000_000, 500_000);

    client.open_appeal(&v1, &cid);

    // The newly eligible voter must be accepted by vote_on_appeal.
    client.vote_on_appeal(&late_voter, &cid, &VoteOption::Approve);

    let claim = client.get_claim(&cid);
    assert_eq!(claim.appeal_approve_votes, 1);
}
