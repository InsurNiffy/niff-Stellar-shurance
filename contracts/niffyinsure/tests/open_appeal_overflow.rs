//! Integration coverage for `open_appeal` Overflow is in
//! `src/claim.rs::open_appeal_overflow_tests` (direct call — contract entry
//! auto-extends TTL and panics near `u32::MAX` before user code runs).
//!
//! This file keeps a cheap wiring check that the Overflow error code stays
//! mapped and that a successful open_appeal still sets a non-wrapping deadline.

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{ClaimStatus, VoteOption, APPEAL_VOTE_WINDOW_LEDGERS},
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
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client)
}

fn seed(client: &NiffyInsureClient, holder: &Address) {
    client.test_seed_policy(holder, &1u32, &1_000_000i128, &500_000u32);
}

#[test]
fn open_appeal_deadline_is_checked_add_of_vote_window() {
    let (env, client) = setup();
    client.admin_set_quorum_bps(&5_000u32);

    let claimant = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &claimant);
    seed(&client, &v2);
    seed(&client, &v3);

    let details = String::from_str(&env, "overflow wiring");
    let ev = common::empty_evidence(&env);
    let cid = client.file_claim(&claimant, &1u32, &100_000i128, &details, &ev, &None);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v3, &cid, &VoteOption::Reject);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);

    let now = env.ledger().sequence();
    client.open_appeal(&claimant, &cid);

    let expected = now
        .checked_add(APPEAL_VOTE_WINDOW_LEDGERS)
        .expect("safe ledger must not overflow");
    assert_eq!(client.get_claim(&cid).appeal_deadline_ledger, expected);
    assert_eq!(
        u32::MAX.checked_add(APPEAL_VOTE_WINDOW_LEDGERS),
        None,
        "precondition: Overflow path exists for near-max ledgers"
    );
    assert_eq!(
        Error::Overflow as u32,
        24,
        "Overflow discriminant must stay stable"
    );
}
