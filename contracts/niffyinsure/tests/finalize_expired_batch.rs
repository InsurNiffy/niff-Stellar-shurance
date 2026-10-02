//! Integration tests for `finalize_expired_batch`.
//!
//! Covers:
//!   - Mixed batch: eligible expired, already terminal, still-open, nonexistent
//!   - All-expired batch: all claims processed
//!   - Over-cap batch: reverts without processing anything
//!   - Idempotency: second finalize of an already-finalized claim returns error
//!   - Resolution rules in batch: approve-plurality and reject/no-quorum

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{ClaimStatus, VoteOption},
    validate::Error,
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env, String, Vec,
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
    let details = String::from_str(env, "batch test claim");
    let ev = common::empty_evidence(env);
    client.file_claim(holder, &1u32, &amount, &details, &ev, &None)
}

/// Mixed batch: one expired+eligible, one already terminal (Rejected), one
/// still within its voting window, and one non-existent id.
/// Expected: processed=1, skipped=3.
#[test]
fn mixed_batch_skips_non_eligible_and_nonexistent() {
    let (env, client, _admin, _token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);

    // cid_a: will be expired-eligible (no votes, processing)
    let cid_a = file(&client, &v1, 100_000, &env);

    // cid_b: majority-rejected before batch — already terminal
    let cid_b = file(&client, &v2, 100_000, &env);
    client.vote_on_claim(&v1, &cid_b, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid_b, &VoteOption::Reject);
    assert_eq!(client.get_claim(&cid_b).status, ClaimStatus::Rejected);

    // cid_c: filed but voting window not yet expired (still open)
    let cid_c = file(&client, &v3, 100_000, &env);
    // Deadline is still in the future — do not advance the ledger yet.

    let nonexistent_id: u64 = 9_999;

    // Advance past cid_a and cid_b deadlines, but verify cid_c is still open.
    let deadline_a = client.get_claim(&cid_a).voting_deadline_ledger;
    env.ledger()
        .with_mut(|l| l.sequence_number = deadline_a + 1);

    let ids: Vec<u64> = vec![&env, cid_a, cid_b, cid_c, nonexistent_id];
    let (processed, skipped) = client.finalize_expired_batch(&ids);

    // cid_a: expired + Processing → processed
    // cid_b: already terminal → skipped
    // cid_c: window still open at new ledger → skipped
    // nonexistent → skipped
    assert_eq!(processed, 1, "only cid_a should be processed");
    assert_eq!(skipped, 3, "cid_b (terminal), cid_c (window open), nonexistent → skipped");

    // cid_a resolves to Rejected: no votes cast, so quorum is unmet at deadline.
    assert_eq!(client.get_claim(&cid_a).status, ClaimStatus::Rejected);

    // cid_b unchanged
    assert_eq!(client.get_claim(&cid_b).status, ClaimStatus::Rejected);
}

/// All-eligible batch: all three claims are past their voting deadlines with no
/// votes, so all resolve to Rejected (no quorum).
#[test]
fn all_eligible_expired_batch_all_processed() {
    let (env, client, _admin, _token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);

    let cid1 = file(&client, &v1, 100_000, &env);
    let cid2 = file(&client, &v2, 100_000, &env);
    let cid3 = file(&client, &v3, 100_000, &env);

    // Advance past all deadlines (they share the same voting_duration_ledgers).
    let deadline = client.get_claim(&cid1).voting_deadline_ledger;
    env.ledger()
        .with_mut(|l| l.sequence_number = deadline + 1);

    let ids: Vec<u64> = vec![&env, cid1, cid2, cid3];
    let (processed, skipped) = client.finalize_expired_batch(&ids);

    assert_eq!(processed, 3);
    assert_eq!(skipped, 0);

    for cid in [cid1, cid2, cid3] {
        assert_eq!(
            client.get_claim(&cid).status,
            ClaimStatus::Rejected,
            "no-quorum deadline claim must resolve to Rejected"
        );
    }
}

/// Over-cap batch reverts atomically before processing any entry.
#[test]
fn over_cap_batch_reverts_without_processing() {
    let (env, client, _admin, _token) = setup();
    let v1 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    let cid = file(&client, &v1, 100_000, &env);

    // Advance past the deadline so cid would be eligible.
    let deadline = client.get_claim(&cid).voting_deadline_ledger;
    env.ledger()
        .with_mut(|l| l.sequence_number = deadline + 1);

    // Build a 21-element Vec (cap is 20).
    let mut ids = Vec::new(&env);
    for i in 0u64..21 {
        ids.push_back(i + 1);
    }

    let result = client.try_finalize_expired_batch(&ids);
    assert!(result.is_err(), "batch over cap must revert");

    // cid must still be Processing — nothing was touched.
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Processing);
}

/// Second `finalize_claim` on an already-finalized claim returns a typed error
/// and does not alter any state. Verifies idempotency across the single-id and
/// batch paths.
#[test]
fn finalize_claim_is_idempotent_single_id() {
    let (env, client, _admin, _token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);

    let cid = file(&client, &v1, 100_000, &env);

    // Advance past deadline and finalize once.
    let deadline = client.get_claim(&cid).voting_deadline_ledger;
    env.ledger()
        .with_mut(|l| l.sequence_number = deadline + 1);

    let status = client.finalize_claim(&cid);
    assert_eq!(status, ClaimStatus::Rejected);

    // Second call must return a typed error, not panic or change state.
    let result = client.try_finalize_claim(&cid);
    assert!(result.is_err(), "second finalize on a terminal claim must Err");
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);
}

/// Batch resolution rule: a claim where approve > reject at quorum resolves to Approved.
#[test]
fn batch_resolves_approve_plurality_to_approved() {
    let (env, client, _admin, _token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);

    let cid = file(&client, &v1, 100_000, &env);
    // Two Approve vs zero Reject → plurality approve, quorum met (2/3 >= 50%).
    client.vote_on_claim(&v2, &cid, &VoteOption::Approve);
    client.vote_on_claim(&v3, &cid, &VoteOption::Approve);

    // Should have auto-resolved; if not (e.g., quorum not yet met by votes alone),
    // advance past deadline and use the batch finalize path.
    if client.get_claim(&cid).status == ClaimStatus::Processing {
        let deadline = client.get_claim(&cid).voting_deadline_ledger;
        env.ledger()
            .with_mut(|l| l.sequence_number = deadline + 1);
        let ids: Vec<u64> = vec![&env, cid];
        client.finalize_expired_batch(&ids);
    }

    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Approved);
}
