//! Integration test: file → reject → appeal → approve on appeal → process_claim.
//!
//! `process_claim` is the only code path that transfers payout tokens. This
//! test proves an `AppealApproved` claim flows through that exact same path
//! as a directly `Approved` claim — no special-cased gap. As of this test,
//! `process_claim` (src/claim.rs) already accepts both
//! `ClaimStatus::Approved` and `ClaimStatus::AppealApproved` via the same
//! guard (`claim.status != Approved && claim.status != AppealApproved`), so
//! this test is a regression guard against that check narrowing back to
//! `Approved` only.

#![cfg(test)]

mod common;

use niffyinsure::{types::ClaimStatus, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token_address = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token_address);
    // Fund the contract's own treasury so process_claim's payout transfer succeeds.
    token::StellarAssetClient::new(&env, &token_address).mint(&contract_id, &500_000_000i128);
    (env, client, admin, token_address)
}

fn seed(client: &NiffyInsureClient, holder: &Address, coverage: i128, end_ledger: u32) {
    client.test_seed_policy(holder, &1u32, &coverage, &end_ledger);
}

fn file(client: &NiffyInsureClient, holder: &Address, amount: i128, env: &Env) -> u64 {
    let details = String::from_str(env, "brief claim description");
    let ev = common::empty_evidence(env);
    client.file_claim(holder, &1u32, &amount, &details, &ev, &None)
}

/// A claim rejected, then won on appeal, must be payable through the same
/// `process_claim` entrypoint used for a direct approval — same dispute
/// window gating, same `payout()` call, same terminal `Paid` status.
#[test]
fn appeal_approved_claim_pays_out_through_process_claim() {
    let (env, client, _admin, _token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);

    let cid = file(&client, &v1, 100_000, &env);

    // Reject on first vote.
    client.vote_on_claim(&v1, &cid, &niffyinsure::types::VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &niffyinsure::types::VoteOption::Reject);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);

    // Claimant appeals.
    client.open_appeal(&v1, &cid);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::UnderAppeal);

    // Appeal round: majority approve reverses the rejection.
    client.vote_on_appeal(&v1, &cid, &niffyinsure::types::VoteOption::Approve);
    client.vote_on_appeal(&v2, &cid, &niffyinsure::types::VoteOption::Approve);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::AppealApproved);

    // Same dispute-window gating applies to AppealApproved as to a direct
    // Approved — advance past the dispute deadline set by finalize_appeal.
    let dispute_deadline = client.get_claim(&cid).dispute_deadline_ledger;
    env.ledger()
        .with_mut(|l| l.sequence_number = dispute_deadline + 1);

    // process_claim is the standard payout path — no separate appeal-specific
    // payout entrypoint exists, and none is needed.
    client.process_claim(&cid);

    let final_claim = client.get_claim(&cid);
    assert_eq!(
        final_claim.status,
        ClaimStatus::Paid,
        "AppealApproved claim must reach Paid through the standard process_claim path"
    );
}
