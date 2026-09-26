//\! Tests for Issue #831: Claim state machine — invalid transition tests.
//\!
//\! Asserts that every invalid direct status transition reverts.
#\![cfg(test)]
mod common;

use niffyinsure::NiffyInsureClient;
use niffyinsure::types::{ClaimStatus, VoteOption};
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

/// Helper: file a claim and return the claim_id
fn file_test_claim(
    env: &Env,
    client: &NiffyInsureClient,
    holder: &Address,
) -> u64 {
    client.test_seed_policy(holder, &1u32, &1_000_000i128, &200_000u32);
    let details = String::from_str(env, "test claim");
    let ev = common::empty_evidence(env);
    client.file_claim(holder, &1u32, &100_000i128, &details, &ev, &None)
}

#[test]
fn withdrawn_claim_cannot_be_finalized() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let cid = file_test_claim(&env, &client, &holder);
    client.withdraw_claim(&holder, &cid);
    // Advance past voting deadline
    env.ledger().with_mut(|l| l.sequence_number = 300_000);
    let result = client.try_finalize_claim(&cid);
    assert\!(result.is_err(), "finalize on Withdrawn claim must revert");
}

#[test]
fn withdrawn_claim_cannot_be_voted_on() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let voter = Address::generate(&env);
    client.test_add_voter(voter.clone());
    let cid = file_test_claim(&env, &client, &holder);
    client.withdraw_claim(&holder, &cid);
    let result = client.try_vote_on_claim(&voter, &cid, &VoteOption::Approve);
    assert\!(result.is_err(), "voting on Withdrawn claim must revert");
}

#[test]
fn paid_claim_cannot_be_disputed() {
    let (env, client, admin, _) = setup();
    let holder = Address::generate(&env);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    client.test_add_voter(v1.clone());
    client.test_add_voter(v2.clone());
    let cid = file_test_claim(&env, &client, &holder);
    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    client.vote_on_claim(&v2, &cid, &VoteOption::Approve);
    // Advance past voting deadline
    env.ledger().with_mut(|l| l.sequence_number = 300_000);
    client.finalize_claim(&cid);
    // Process payout
    client.process_claim(&cid);
    // Attempt to dispute after payment
    let result = client.try_admin_dispute_claim(&admin, &cid);
    assert\!(result.is_err(), "disputing a Paid claim must revert");
}

#[test]
fn rejected_claim_cannot_be_paid() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    client.test_add_voter(v1.clone());
    client.test_add_voter(v2.clone());
    let cid = file_test_claim(&env, &client, &holder);
    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);
    env.ledger().with_mut(|l| l.sequence_number = 300_000);
    client.finalize_claim(&cid);
    let result = client.try_process_claim(&cid);
    assert\!(result.is_err(), "paying a Rejected claim must revert");
}

#[test]
fn appeal_rejected_claim_cannot_be_appealed_again() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    client.test_add_voter(v1.clone());
    client.test_add_voter(v2.clone());
    let cid = file_test_claim(&env, &client, &holder);
    // Reject the claim
    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);
    env.ledger().with_mut(|l| l.sequence_number = 300_000);
    client.finalize_claim(&cid);
    // Open appeal
    client.open_appeal(&holder, &cid);
    // Reject the appeal
    client.vote_on_appeal(&v1, &cid, &VoteOption::Reject);
    client.vote_on_appeal(&v2, &cid, &VoteOption::Reject);
    env.ledger().with_mut(|l| l.sequence_number = 500_000);
    client.finalize_appeal(&cid);
    // Try to appeal again
    let result = client.try_open_appeal(&holder, &cid);
    assert\!(result.is_err(), "re-appealing an AppealRejected claim must revert");
}
