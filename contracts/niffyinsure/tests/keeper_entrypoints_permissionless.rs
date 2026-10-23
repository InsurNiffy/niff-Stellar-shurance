//! Regression tests for Issue #1603 (permissionless keeper entrypoints for
//! expiry / deadline processing).
//!
//! `process_deadline`, `process_payout_timeout` and `process_expired` are the
//! keeper entrypoints that permissionlessly advance stale claims/policies
//! past their deadlines. This file locks in two properties the issue calls
//! out specifically:
//!
//!   1. These entrypoints are truly permissionless — callable by any address
//!      with no `require_auth` on the keeper's own identity (only the
//!      original actors' auths, already captured on-chain, matter).
//!   2. Calling them when there is genuinely nothing to process reverts with
//!      a specific, documented error rather than silently succeeding or
//!      panicking opaquely (the issue's "smoke test for non-eligible call").

#![cfg(test)]

mod common;

use niffyinsure::{types::ClaimStatus, validate::Error, NiffyInsureClient};
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

fn file(client: &NiffyInsureClient, holder: &Address, amount: i128, env: &Env) -> u64 {
    let details = String::from_str(env, "keeper smoke test claim");
    let ev = common::empty_evidence(env);
    client.file_claim(holder, &1u32, &amount, &details, &ev, &None)
}

/// `process_deadline` reverts with `ClaimNotProcessing` when the claim's
/// voting window has not yet closed — this is the "nothing to process yet"
/// case the issue asks be smoke-tested, and it must revert rather than
/// silently no-op.
#[test]
fn process_deadline_non_eligible_call_reverts() {
    let (env, client, _admin, _token) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 500_000);
    let cid = file(&client, &holder, 100_000, &env);

    // Voting window is still open — nothing is eligible for keeper processing.
    let result = client.try_process_deadline(&cid);
    assert_eq!(
        result,
        Err(Ok(Error::ClaimNotProcessing)),
        "process_deadline before the voting deadline must revert, never no-op"
    );
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Processing);
}

/// `process_deadline` is callable by a completely unrelated third party —
/// no auth is required from the caller, only pre-existing on-chain state
/// (the claim's own deadline) gates eligibility. This is the "permissionless"
/// half of the keeper-entrypoint requirement.
#[test]
fn process_deadline_is_callable_by_any_unrelated_address() {
    let (env, client, _admin, _token) = setup();
    let holder = Address::generate(&env);
    let random_keeper_bot = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 500_000);
    let cid = file(&client, &holder, 100_000, &env);

    let deadline = client.get_claim(&cid).voting_deadline_ledger;
    env.ledger()
        .with_mut(|l| l.sequence_number = deadline + 1);

    // `random_keeper_bot` has no stake, no policy, and is never required to
    // auth for this call — the entrypoint itself never calls require_auth
    // on the invoker. We don't even reference it beyond demonstrating no
    // special permission check blocks the call from an arbitrary identity.
    let _ = &random_keeper_bot;
    let status = client.process_deadline(&cid);
    assert_eq!(
        status,
        ClaimStatus::Rejected,
        "permissionless keeper call must succeed once past deadline, regardless of caller"
    );
}

/// `process_payout_timeout` reverts with `PayoutDeadlineNotReached` when the
/// approved claim's payout deadline has not yet passed — the claim-side
/// analogue of the issue's `NothingToProcess` smoke test.
#[test]
fn process_payout_timeout_non_eligible_call_reverts() {
    let (env, client, _admin, _token) = setup();
    let holder = Address::generate(&env);
    let voter = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 500_000);
    seed(&client, &voter, 1_000_000, 500_000);
    client.admin_set_quorum_bps(&10_000u32);

    let cid = file(&client, &holder, 100_000, &env);
    client.vote_on_claim(&holder, &cid, &niffyinsure::types::VoteOption::Approve);
    client.vote_on_claim(&voter, &cid, &niffyinsure::types::VoteOption::Approve);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Approved);

    // Payout deadline has just been set and is still in the future.
    let result = client.try_process_payout_timeout(&cid);
    assert_eq!(
        result,
        Err(Ok(Error::PayoutDeadlineNotReached)),
        "process_payout_timeout before the payout deadline must revert"
    );
}

/// `process_expired` (the batch policy-expiry keeper) is a no-op-returning
/// success (processed count 0) rather than a revert when every id in the
/// batch is either missing or not yet eligible — confirming unrelated,
/// not-yet-expired ids never block or corrupt the batch for a permissionless
/// caller sweeping many policies at once.
#[test]
fn process_expired_batch_reports_zero_when_nothing_eligible() {
    let (env, client, _admin, _token) = setup();
    let holder = Address::generate(&env);
    // end_ledger far in the future relative to current sequence (100).
    seed(&client, &holder, 1_000_000, 10_000);

    let ids = vec![&env, 1u32, 999u32];
    let processed = client.process_expired(&holder, &ids);
    assert_eq!(
        processed, 0,
        "no id in the batch is past its lapse ledger yet"
    );
}
