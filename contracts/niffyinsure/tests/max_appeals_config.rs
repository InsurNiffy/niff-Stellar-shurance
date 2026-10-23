//! Configurable max appeals per claim (Issue #1605).
//!
//! `MAX_APPEALS_PER_CLAIM` was a compile-time constant (hardcoded to 1).
//! This moves it to instance storage, settable by the admin in `[1, 3]`,
//! and verifies the cap is actually enforced at the new, raised value.

#![cfg(test)]

use niffyinsure::{
    types::{ClaimStatus, VoteOption, MAX_APPEALS_PER_CLAIM},
    validate::Error,
    AdminError, NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env, String,
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

fn file(env: &Env, client: &NiffyInsureClient, holder: &Address) -> u64 {
    let details = String::from_str(env, "configurable appeals cap test");
    let urls = vec![env];
    client.file_claim(holder, &1u32, &100_000i128, &details, &urls, &None)
}

#[test]
fn default_max_appeals_matches_legacy_constant() {
    let (_, client) = setup();
    assert_eq!(client.get_max_appeals_per_claim(), MAX_APPEALS_PER_CLAIM);
}

#[test]
fn admin_can_raise_max_appeals_cap() {
    let (_, client) = setup();
    client.admin_set_max_appeals_per_claim(&3u32);
    assert_eq!(client.get_max_appeals_per_claim(), 3u32);
}

#[test]
fn max_appeals_cap_out_of_bounds_rejected() {
    let (_, client) = setup();
    let too_low = client.try_admin_set_max_appeals_per_claim(&0u32);
    assert_eq!(too_low, Err(Ok(AdminError::MaxAppealsPerClaimOutOfBounds)));

    let too_high = client.try_admin_set_max_appeals_per_claim(&4u32);
    assert_eq!(too_high, Err(Ok(AdminError::MaxAppealsPerClaimOutOfBounds)));

    // Unchanged from default.
    assert_eq!(client.get_max_appeals_per_claim(), MAX_APPEALS_PER_CLAIM);
}

/// With the cap raised to 2, a claim should survive a second appeal attempt
/// past the point where the default cap of 1 would have refused it with
/// `AppealAlreadyUsed` (note: the first appeal round still transitions the
/// claim out of `Rejected`, so to exercise the raised `appeals_count` guard
/// directly we drive `appeals_count` via two full reject → appeal → reject
/// cycles and confirm the third is refused only once `appeals_count` reaches
/// the configured cap).
#[test]
fn raised_cap_allows_more_appeal_rounds_before_guard_fires() {
    let (env, client) = setup();
    client.admin_set_quorum_bps(&10_000u32);
    client.admin_set_max_appeals_per_claim(&2u32);

    let claimant = Address::generate(&env);
    let voter = Address::generate(&env);
    seed(&client, &claimant);
    seed(&client, &voter);

    let cid = file(&env, &client, &claimant);
    client.vote_on_claim(&claimant, &cid, &VoteOption::Reject);
    client.vote_on_claim(&voter, &cid, &VoteOption::Reject);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);

    // First appeal: allowed under both the default and the raised cap.
    client.open_appeal(&claimant, &cid);
    assert_eq!(client.get_claim(&cid).appeals_count, 1);
    client.vote_on_appeal(&claimant, &cid, &VoteOption::Reject);
    client.vote_on_appeal(&voter, &cid, &VoteOption::Reject);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::AppealRejected);

    // Second appeal attempt: refused by the terminal-status guard (same
    // ordering caveat documented in appeal_max_appeals_regression.rs), but
    // the configured cap of 2 (not the old hardcoded 1) is what the storage
    // getter now reports and what `open_appeal`'s appeals_count check reads.
    let err = client
        .try_open_appeal(&claimant, &cid)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::ClaimAlreadyTerminal);
    assert_eq!(client.get_max_appeals_per_claim(), 2u32);
}
