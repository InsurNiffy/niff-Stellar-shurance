//! Tie-breaking rule: when `approve_votes == reject_votes` exactly at
//! resolution time, the claim must resolve to `Rejected` — deterministically,
//! regardless of the order votes were submitted in. See
//! `docs/GOVERNANCE.md` and the "Tie-breaking rule" comment in
//! `src/claim.rs::finalize_claim_inner`.

#![cfg(test)]

use niffyinsure::{types::ClaimStatus, types::VoteOption, NiffyInsureClient};
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

fn seed(client: &NiffyInsureClient, holder: &Address, coverage: i128, end_ledger: u32) {
    client.test_seed_policy(holder, &1u32, &coverage, &end_ledger);
}

/// Two-voter electorate (excluding the claimant), 100% quorum, so a single
/// approve + a single reject is both a tie AND enough to meet quorum.
fn tied_claim(env: &Env, client: &NiffyInsureClient, approve_first: bool) -> (u64, Address, Address) {
    let holder = Address::generate(env);
    let v1 = Address::generate(env);
    let v2 = Address::generate(env);
    seed(client, &holder, 1_000_000, 10_000);
    seed(client, &v1, 1_000_000, 10_000);
    seed(client, &v2, 1_000_000, 10_000);
    // Exclude the claimant from the electorate so eligible_voter_count == 2.
    client.test_remove_voter(&holder);

    client.admin_set_quorum_bps(&10_000u32); // 100% participation required

    let details = String::from_str(env, "tie vote test");
    let urls = vec![env];
    let claim_id = client.file_claim(&holder, &1u32, &100_000i128, &details, &urls, &None);

    if approve_first {
        client.vote_on_claim(&v1, &claim_id, &VoteOption::Approve);
        client.vote_on_claim(&v2, &claim_id, &VoteOption::Reject);
    } else {
        client.vote_on_claim(&v2, &claim_id, &VoteOption::Reject);
        client.vote_on_claim(&v1, &claim_id, &VoteOption::Approve);
    }
    (claim_id, v1, v2)
}

#[test]
fn tie_resolves_to_rejected_approve_submitted_first() {
    let (env, client, _admin, _token) = setup();
    let (claim_id, _v1, _v2) = tied_claim(&env, &client, true);

    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.approve_votes, claim.reject_votes);
    assert_eq!(claim.status, ClaimStatus::Rejected);
}

#[test]
fn tie_resolves_to_rejected_reject_submitted_first() {
    let (env, client, _admin, _token) = setup();
    let (claim_id, _v1, _v2) = tied_claim(&env, &client, false);

    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.approve_votes, claim.reject_votes);
    // Outcome must be identical to the approve-first ordering: order of
    // vote submission must not affect the tie-break result.
    assert_eq!(claim.status, ClaimStatus::Rejected);
}
