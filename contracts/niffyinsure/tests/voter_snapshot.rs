//! #584 — Voter eligibility snapshot: block-height-anchored eligibility freeze.
//!
//! Voters eligible at filing but not at vote time can still vote.
//! Voters not eligible at filing cannot vote even if they become eligible later.
//! Snapshot is immutable after claim creation.

#![cfg(test)]

use niffyinsure::{types::VoteOption, validate::Error, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env, String,
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

fn seed(client: &NiffyInsureClient, holder: &Address, end_ledger: u32) {
    client.test_seed_policy(holder, &1u32, &1_000_000i128, &end_ledger);
}

fn file(env: &Env, client: &NiffyInsureClient, holder: &Address) -> u64 {
    let details = String::from_str(env, "snapshot test");
    let urls = vec![env];
    client.file_claim(holder, &1u32, &100_000i128, &details, &urls, &None)
}

// ── Voter eligible at filing but removed before vote time can still vote ──────

#[test]
fn voter_eligible_at_filing_can_vote_after_removal() {
    let (env, client, _, _) = setup();

    let claimant = Address::generate(&env);
    let voter = Address::generate(&env);

    // Both are in the voter registry at filing time.
    seed(&client, &claimant, 50_000);
    seed(&client, &voter, 50_000);

    let cid = file(&env, &client, &claimant);

    // Remove voter from registry AFTER filing (simulate losing eligibility).
    client.test_remove_voter(&voter);

    // Voter should still be able to vote (snapshot was taken at filing).
    client.vote_on_claim(&voter, &cid, &VoteOption::Approve);

    let claim = client.get_claim(&cid);
    assert_eq!(claim.approve_votes, 1);
}

// ── Voter not eligible at filing cannot vote even if added later ──────────────

#[test]
fn voter_not_eligible_at_filing_cannot_vote_after_joining() {
    let (env, client, _, _) = setup();

    let claimant = Address::generate(&env);
    let late_voter = Address::generate(&env);

    // Only claimant is in registry at filing time.
    seed(&client, &claimant, 50_000);

    let cid = file(&env, &client, &claimant);

    // late_voter joins registry AFTER the claim was filed.
    seed(&client, &late_voter, 50_000);

    // late_voter should NOT be able to vote (not in snapshot).
    let err = client
        .try_vote_on_claim(&late_voter, &cid, &VoteOption::Approve)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::NotEligibleVoter);
}

// ── Snapshot is immutable: eligible_voter_count does not change after filing ──

#[test]
fn snapshot_voter_count_is_immutable_after_filing() {
    let (env, client, _, _) = setup();

    let claimant = Address::generate(&env);
    let voter2 = Address::generate(&env);

    seed(&client, &claimant, 50_000);
    // Only claimant in registry at filing → after exclude-claimant, count is 0.
    let cid = file(&env, &client, &claimant);

    let count_at_filing = client.get_claim(&cid).eligible_voter_count;
    assert_eq!(count_at_filing, 0);

    // Add another voter after filing.
    seed(&client, &voter2, 50_000);

    // Count must not change.
    let count_after = client.get_claim(&cid).eligible_voter_count;
    assert_eq!(count_at_filing, count_after);
}

#[test]
fn snapshot_excludes_claimant() {
    let (env, client, _, _) = setup();
    let claimant = Address::generate(&env);
    let voter = Address::generate(&env);
    seed(&client, &claimant, 50_000);
    seed(&client, &voter, 50_000);
    let cid = file(&env, &client, &claimant);
    let snap = client.test_get_claim_voters(&cid);
    assert!(!snap.iter().any(|a| a == claimant));
    assert!(snap.iter().any(|a| a == voter));
    assert_eq!(snap.len(), 1);
}

#[test]
fn snapshot_respects_max_voters_per_claim() {
    let (env, client, _, _) = setup();
    let claimant = Address::generate(&env);
    seed(&client, &claimant, 50_000);
    for _ in 0..6 {
        let v = Address::generate(&env);
        seed(&client, &v, 50_000);
    }
    client.admin_set_max_voters_per_claim(&2u32);
    let cid = file(&env, &client, &claimant);
    let snap = client.test_get_claim_voters(&cid);
    assert_eq!(snap.len(), 2);
    assert!(!snap.iter().any(|a| a == claimant));
}

// ── Voter in snapshot can cast a vote ────────────────────────────────────────

#[test]
fn voter_in_snapshot_can_vote() {
    let (env, client, _, _) = setup();

    let claimant = Address::generate(&env);
    let voter = Address::generate(&env);

    seed(&client, &claimant, 50_000);
    seed(&client, &voter, 50_000);

    let cid = file(&env, &client, &claimant);

    // Both are in snapshot; voter can vote.
    client.vote_on_claim(&voter, &cid, &VoteOption::Reject);
    assert_eq!(client.get_claim(&cid).reject_votes, 1);
}
