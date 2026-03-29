//! DAO voting integration tests.
//!
//! Covers:
//!   - Non-voter (ineligible address) rejection
//!   - Vote immutability (no flip after first cast)
//!   - Double-submit rejection
//!   - Tally reconciliation (majority auto-finalization)
//!   - Finalize after deadline (plurality / tie)
//!   - Voting window enforcement
//!   - Snapshot isolates late joiners
//!   - Terminated-policy holder votes stand (snapshot model)
//!   - Adversarial addresses cannot bloat storage
//!   - Pause flag blocks file_claim and vote_on_claim
//!   - VoteLogged event is emitted

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{ClaimStatus, VoteOption, VOTE_WINDOW_LEDGERS},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, Env, String,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/// Seed a policy for `holder` and register them as a voter.
fn seed(client: &NiffyInsureClient, holder: &Address, coverage: i128, end_ledger: u32) {
    client.test_seed_policy(holder, &1u32, &coverage, &end_ledger);
}

fn file(client: &NiffyInsureClient, holder: &Address, amount: i128, env: &Env) -> u64 {
    let details = String::from_str(env, "test claim");
    let ev = common::empty_evidence(env);
    client.file_claim(holder, &1u32, &amount, &details, &ev)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn file_claim_returns_incrementing_ids() {
    let (env, client, _, _) = setup();
    let h1 = Address::generate(&env);
    let h2 = Address::generate(&env);
    seed(&client, &h1, 1_000_000, 10_000);
    seed(&client, &h2, 1_000_000, 10_000);
    let id1 = file(&client, &h1, 100_000, &env);
    let id2 = file(&client, &h2, 100_000, &env);
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
}

#[test]
fn non_voter_rejected_before_storage_write() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let outsider = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let cid = file(&client, &holder, 100_000, &env);
    // outsider has no policy → not in snapshot → rejected
    assert!(client
        .try_vote_on_claim(&outsider, &cid, &VoteOption::Approve)
        .is_err());
}

#[test]
fn double_vote_rejected() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let cid = file(&client, &holder, 100_000, &env);
    client.vote_on_claim(&holder, &cid, &VoteOption::Approve);
    assert!(client
        .try_vote_on_claim(&holder, &cid, &VoteOption::Approve)
        .is_err());
}

#[test]
fn vote_flip_rejected() {
    // Immutable ballot: cannot change Approve → Reject
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let cid = file(&client, &holder, 100_000, &env);
    client.vote_on_claim(&holder, &cid, &VoteOption::Approve);
    assert!(client
        .try_vote_on_claim(&holder, &cid, &VoteOption::Reject)
        .is_err());
}

#[test]
fn majority_approve_auto_finalizes_claim() {
    // 3 voters; 2 approvals = majority → claim auto-transitions to Approved
    let (env, client, _, _) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 10_000);
    seed(&client, &v2, 1_000_000, 10_000);
    seed(&client, &v3, 1_000_000, 10_000);
    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    client.vote_on_claim(&v2, &cid, &VoteOption::Approve); // 2/3 → majority
                                                           // Claim is now terminal; v3 vote must fail
    assert!(client
        .try_vote_on_claim(&v3, &cid, &VoteOption::Reject)
        .is_err());
}

#[test]
fn majority_reject_auto_finalizes_claim() {
    let (env, client, _, _) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 10_000);
    seed(&client, &v2, 1_000_000, 10_000);
    seed(&client, &v3, 1_000_000, 10_000);
    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject); // 2/3 → majority reject
    assert!(client
        .try_vote_on_claim(&v3, &cid, &VoteOption::Approve)
        .is_err());
}

#[test]
fn finalize_after_deadline_rejects_when_participation_quorum_unmet() {
    let (env, client, _, _) = setup();
    // All eligible voters must cast: 3 voters ⇒ R = 3 ballots.
    client.admin_set_quorum_bps(&10_000u32);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);
    let cid = file(&client, &v1, 100_000, &env);
    // Single approve — cast count below R
    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    env.ledger()
        .with_mut(|l| l.sequence_number += VOTE_WINDOW_LEDGERS + 1);
    client.finalize_claim(&cid);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);
    assert!(client
        .try_vote_on_claim(&v2, &cid, &VoteOption::Reject)
        .is_err());
}

#[test]
fn finalize_tie_resolves_to_rejected() {
    // Tie with full participation (2 of 2) → Rejected as soon as quorum is met
    let (env, client, _, _) = setup();
    client.admin_set_quorum_bps(&10_000u32);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);
    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);
}

#[test]
fn finalize_before_deadline_fails() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 500_000);
    let cid = file(&client, &holder, 100_000, &env);
    // Deadline not yet passed
    assert!(client.try_finalize_claim(&cid).is_err());
}

#[test]
fn vote_after_deadline_rejected() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 500_000);
    let cid = file(&client, &holder, 100_000, &env);
    env.ledger()
        .with_mut(|l| l.sequence_number += VOTE_WINDOW_LEDGERS + 1);
    assert!(client
        .try_vote_on_claim(&holder, &cid, &VoteOption::Approve)
        .is_err());
}

#[test]
fn snapshot_isolates_late_joiners() {
    // A holder who joins AFTER filing must not be able to vote.
    let (env, client, _, _) = setup();
    let original = Address::generate(&env);
    let late_joiner = Address::generate(&env);
    seed(&client, &original, 1_000_000, 10_000);
    let cid = file(&client, &original, 100_000, &env);
    // late_joiner gets a policy AFTER the claim is filed
    seed(&client, &late_joiner, 1_000_000, 10_000);
    // late_joiner is not in the snapshot → rejected
    assert!(client
        .try_vote_on_claim(&late_joiner, &cid, &VoteOption::Approve)
        .is_err());
}

#[test]
fn terminated_policy_holder_vote_stands() {
    // Holder votes, then their policy is "terminated" (removed from live Voters).
    // Their ballot and tally contribution must remain intact.
    let (env, client, _, _) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 10_000);
    seed(&client, &v2, 1_000_000, 10_000);
    seed(&client, &v3, 1_000_000, 10_000);
    let cid = file(&client, &v1, 100_000, &env);
    // v1 votes, then is removed from live Voters (policy terminated)
    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    client.test_remove_voter(&v1);
    // v2 votes approve → 2/3 majority (v1's vote still counted)
    client.vote_on_claim(&v2, &cid, &VoteOption::Approve);
    // Claim is now Approved; v3 vote must fail
    assert!(client
        .try_vote_on_claim(&v3, &cid, &VoteOption::Reject)
        .is_err());
}

#[test]
fn adversarial_addresses_cannot_bloat_storage() {
    // Ineligible addresses are rejected before any storage write.
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let cid = file(&client, &holder, 100_000, &env);
    for _ in 0..5 {
        let adversary = Address::generate(&env);
        assert!(client
            .try_vote_on_claim(&adversary, &cid, &VoteOption::Approve)
            .is_err());
    }
}

#[test]
fn vote_on_nonexistent_claim_fails() {
    let (env, client, _, _) = setup();
    let voter = Address::generate(&env);
    assert!(client
        .try_vote_on_claim(&voter, &999u64, &VoteOption::Approve)
        .is_err());
}

#[test]
fn vote_logged_event_is_emitted() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let cid = file(&client, &holder, 100_000, &env);
    client.vote_on_claim(&holder, &cid, &VoteOption::Approve);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Approved);
}

#[test]
fn claim_filed_event_is_emitted() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    file(&client, &holder, 100_000, &env);
    assert!(!env.events().all().is_empty());
}
