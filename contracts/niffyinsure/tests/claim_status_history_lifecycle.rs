//! Regression test for Issue #1602 (append-only status history log).
//!
//! `ClaimStatusHistoryEntry { status, ledger }` and the `ClaimStatusHistory`
//! trail already exist (`Claim::status_history`, capped at
//! `CLAIM_STATUS_HISTORY_MAX`, exposed via `get_claim_history`). The existing
//! unit test in `src/claim.rs` only exercises the FIFO cap with a synthetic
//! vector. This file closes the gap with an integration test that drives a
//! real claim through multiple status transitions end-to-end and asserts the
//! on-chain history (as the frontend claim timeline would read it via
//! `get_claim_history`) records each transition in order, which is the
//! actual product requirement in #1602.

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
    let details = String::from_str(env, "status history lifecycle test");
    let ev = common::empty_evidence(env);
    client.file_claim(holder, &1u32, &amount, &details, &ev, &None)
}

/// File → approve-vote to quorum (Approved) → wait out payout deadline
/// (PayoutTimeout). The timeline must show exactly
/// [Processing, Approved, PayoutTimeout] in that order, matching the ledgers
/// at which each transition actually happened — this is what the frontend
/// claim timeline (the stated motivation for #1602) renders directly.
#[test]
fn history_records_full_lifecycle_in_order() {
    let (env, client, _admin, _token) = setup();
    let holder = Address::generate(&env);
    let voter = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 500_000);
    seed(&client, &voter, 1_000_000, 500_000);
    client.admin_set_quorum_bps(&10_000u32);

    let filed_at = env.ledger().get().sequence_number;
    let cid = file(&client, &holder, 100_000, &env);

    client.vote_on_claim(&holder, &cid, &niffyinsure::types::VoteOption::Approve);
    let approved_at = env.ledger().get().sequence_number;
    client.vote_on_claim(&voter, &cid, &niffyinsure::types::VoteOption::Approve);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Approved);

    let payout_deadline = client.get_claim(&cid).payout_deadline_ledger;
    env.ledger()
        .with_mut(|l| l.sequence_number = payout_deadline + 1);
    client.process_payout_timeout(&cid);

    let history = client.get_claim_history(&cid).unwrap();
    assert_eq!(history.len(), 3, "expected Processing, Approved, PayoutTimeout");
    assert_eq!(history.get(0).unwrap().status, ClaimStatus::Processing);
    assert_eq!(history.get(0).unwrap().ledger, filed_at);
    assert_eq!(history.get(1).unwrap().status, ClaimStatus::Approved);
    assert_eq!(history.get(1).unwrap().ledger, approved_at);
    assert_eq!(history.get(2).unwrap().status, ClaimStatus::PayoutTimeout);
    assert_eq!(history.get(2).unwrap().ledger, payout_deadline + 1);
}

/// Withdrawing a claim is itself a logged transition (Processing → Withdrawn),
/// not just the voting-driven outcomes — the log is meant to be a complete
/// append-only trail of every status change, not only the voting ones.
#[test]
fn withdrawal_is_logged_as_a_transition() {
    let (env, client, _admin, _token) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 500_000);
    let cid = file(&client, &holder, 100_000, &env);

    client.withdraw_claim(&holder, &cid);

    let history = client.get_claim_history(&cid).unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history.get(0).unwrap().status, ClaimStatus::Processing);
    assert_eq!(history.get(1).unwrap().status, ClaimStatus::Withdrawn);
}
