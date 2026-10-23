//! Issue #1615 — `ClaimStatus::Appealed` is a reserved, never-constructed
//! variant (discriminant 11), superseded by `UnderAppeal` (discriminant 6).
//! See the doc comment on the variant in `types.rs` for the full decision
//! record on why it is kept rather than removed.
//!
//! This asserts that the full claim/appeal lifecycle — including the appeal
//! path that could plausibly be confused with `Appealed` — never produces a
//! claim whose status equals `ClaimStatus::Appealed`, and that the variant
//! correctly reports as non-terminal.
#![cfg(test)]
mod common;

use niffyinsure::types::ClaimStatus;
use niffyinsure::NiffyInsureClient;
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
    let details = String::from_str(env, "appealed-variant regression claim");
    let ev = common::empty_evidence(env);
    client.file_claim(holder, &1u32, &amount, &details, &ev, &None)
}

/// Drives a claim through majority rejection, an opened appeal, and the
/// appeal's deadline-based resolution, asserting at every observed step
/// that the status is never `ClaimStatus::Appealed` — only
/// `ClaimStatus::UnderAppeal` is live for "appeal in progress".
#[test]
fn appeal_lifecycle_never_reaches_appealed_status() {
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

    let rejected_status = client.get_claim(&cid).status;
    assert_eq!(rejected_status, ClaimStatus::Rejected);
    assert_ne!(rejected_status, ClaimStatus::Appealed);

    client.open_appeal(&v1, &cid);
    let appealed_claim = client.get_claim(&cid);
    assert_eq!(appealed_claim.status, ClaimStatus::UnderAppeal);
    assert_ne!(appealed_claim.status, ClaimStatus::Appealed);

    // Resolve the appeal via the deadline-based keeper path (no appeal votes
    // cast, so quorum is unmet and it resolves to AppealRejected).
    let appeal_deadline_ledger = appealed_claim.appeal_deadline_ledger;
    env.ledger()
        .with_mut(|l| l.sequence_number = appeal_deadline_ledger + 1);
    let final_status = client.finalize_appeal(&cid);
    assert_eq!(final_status, ClaimStatus::AppealRejected);
    assert_ne!(final_status, ClaimStatus::Appealed);

    // Full status history recorded on the claim must also never contain
    // the reserved variant.
    let history = client.get_claim_history(&cid);
    for entry in history.iter() {
        assert_ne!(
            entry.status,
            ClaimStatus::Appealed,
            "ClaimStatus::Appealed must never appear in on-chain status history"
        );
    }
}

/// `Appealed` must keep its pinned discriminant (11, appended after the live
/// appeal variants) and must not be classified as terminal — it has no
/// transitions in or out since it is never constructed.
#[test]
fn appealed_discriminant_is_not_terminal() {
    assert_eq!(ClaimStatus::Appealed as u32, 11);
    assert!(!ClaimStatus::Appealed.is_terminal());
}
