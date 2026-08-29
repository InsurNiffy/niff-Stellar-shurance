//! Pins `open_appeal`'s `checked_add(APPEAL_VOTE_WINDOW_LEDGERS)` Overflow path.
//!
//! When the ledger sequence is near `u32::MAX`, adding the appeal vote window
//! must return `Error::Overflow` rather than wrapping or panicking.

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{
        ClaimStatus, VoteOption, APPEAL_OPEN_WINDOW_LEDGERS, APPEAL_VOTE_WINDOW_LEDGERS,
        MIN_VOTING_DURATION_LEDGERS,
    },
    validate::Error,
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

fn setup() -> (Env, NiffyInsureClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    // Initialize at a normal ledger — the host rejects bootstrapping near u32::MAX.
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client)
}

fn seed(client: &NiffyInsureClient, holder: &Address) {
    // Policy must remain active near u32::MAX for the overflow scenario.
    client.test_seed_policy(holder, &1u32, &1_000_000i128, &u32::MAX);
}

/// Force `now` near `u32::MAX` so `now + APPEAL_VOTE_WINDOW_LEDGERS` overflows,
/// while keeping the appeal-open window and base voting duration valid.
#[test]
fn open_appeal_returns_overflow_near_u32_max() {
    // First ledger where now + APPEAL_VOTE_WINDOW_LEDGERS overflows u32.
    let overflow_now = u32::MAX - APPEAL_VOTE_WINDOW_LEDGERS + 1;
    assert!(overflow_now.checked_add(APPEAL_VOTE_WINDOW_LEDGERS).is_none());

    let (env, client) = setup();
    assert!(client
        .try_admin_set_vote_duration_ledgers(&MIN_VOTING_DURATION_LEDGERS)
        .is_ok());
    client.admin_set_quorum_bps(&10_000u32);

    // Preconditions: filing + rejection deadline math must not overflow.
    assert!(overflow_now
        .checked_add(MIN_VOTING_DURATION_LEDGERS)
        .is_some());
    assert!(overflow_now
        .checked_add(APPEAL_OPEN_WINDOW_LEDGERS)
        .is_some());

    let claimant = Address::generate(&env);
    let voter = Address::generate(&env);
    seed(&client, &claimant);
    seed(&client, &voter);

    // Jump near u32::MAX only after init/seed — then file, reject, open_appeal.
    env.ledger().with_mut(|l| l.sequence_number = overflow_now);

    let details = String::from_str(&env, "overflow guard");
    let ev = common::empty_evidence(&env);
    let cid = client.file_claim(&claimant, &1u32, &100_000i128, &details, &ev, &None);

    client.vote_on_claim(&claimant, &cid, &VoteOption::Reject);
    client.vote_on_claim(&voter, &cid, &VoteOption::Reject);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);

    let open_deadline = client.get_claim(&cid).appeal_open_deadline_ledger;
    assert!(
        overflow_now <= open_deadline,
        "overflow ledger must still be inside the appeal-open window"
    );

    let err = client
        .try_open_appeal(&claimant, &cid)
        .err()
        .expect("open_appeal must Err near u32::MAX")
        .unwrap();
    assert_eq!(
        err,
        Error::Overflow,
        "open_appeal must surface Error::Overflow, not panic or wrap"
    );

    // Claim must remain Rejected — no partial state mutation on overflow.
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);
}
