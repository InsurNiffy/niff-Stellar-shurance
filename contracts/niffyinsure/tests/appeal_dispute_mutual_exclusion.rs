//! A claim can never be simultaneously in a claimant-initiated appeal
//! (`open_appeal`, requires `Rejected`) and an admin-initiated dispute
//! (`dispute_claim`, requires `Approved`) — the two status guards are
//! mutually exclusive by construction. See the "Appeal vs. dispute" section
//! in `src/claim.rs` for the documented distinction.

#![cfg(test)]

mod common;

use niffyinsure::{types::ClaimStatus, NiffyInsureClient};
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

fn file(client: &NiffyInsureClient, holder: &Address, amount: i128, env: &Env) -> u64 {
    let details = String::from_str(env, "brief claim description");
    let ev = common::empty_evidence(env);
    client.file_claim(holder, &1u32, &amount, &details, &ev, &None)
}

/// An UnderAppeal claim (claimant-initiated) can never be reached by
/// `dispute_claim` (admin-initiated) — dispute_claim requires `Approved`.
#[test]
fn under_appeal_claim_cannot_be_disputed() {
    let (env, client, _admin, _token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);

    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &niffyinsure::types::VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &niffyinsure::types::VoteOption::Reject);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);

    client.open_appeal(&v1, &cid);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::UnderAppeal);

    // admin_dispute_claim is gated on Approved; an UnderAppeal claim must be rejected.
    let result = client.try_admin_dispute_claim(&cid);
    assert!(
        result.is_err(),
        "admin_dispute_claim must not accept an UnderAppeal claim"
    );
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::UnderAppeal);
}

/// A Disputed claim (admin-initiated) can never be reached by `open_appeal`
/// (claimant-initiated) — open_appeal requires `Rejected`.
#[test]
fn disputed_claim_cannot_open_an_appeal() {
    let (env, client, _admin, _token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);

    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &niffyinsure::types::VoteOption::Approve);
    client.vote_on_claim(&v2, &cid, &niffyinsure::types::VoteOption::Approve);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Approved);

    client.admin_dispute_claim(&cid);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Disputed);

    // open_appeal is gated on Rejected; a Disputed claim must be rejected.
    let result = client.try_open_appeal(&v1, &cid);
    assert!(
        result.is_err(),
        "open_appeal must not accept a Disputed claim"
    );
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Disputed);
}
