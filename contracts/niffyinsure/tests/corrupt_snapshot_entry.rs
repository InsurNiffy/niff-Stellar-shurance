//! Corrupt voter snapshot entries: a seeded zero/negative voting-power entry
//! must revert vote attempts with `CorruptSnapshotEntry`, while normal voting
//! with valid entries is unaffected.

#![cfg(test)]

use niffyinsure::{validate::Error as ValidateError, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env, String,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin)
}

fn seed(client: &NiffyInsureClient, holder: &Address, coverage: i128, end_ledger: u32) {
    client.test_seed_policy(holder, &1u32, &coverage, &end_ledger);
}

#[test]
fn corrupt_snapshot_entry_reverts_vote() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);
    let voter = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    seed(&client, &voter, 1_000_000, 10_000);

    let details = String::from_str(&env, "corrupt snapshot test");
    let urls = vec![&env];
    let claim_id = client.file_claim(&holder, &1u32, &100_000i128, &details, &urls, &None);

    // Seed a corrupt (zero) voting-power entry for `voter` on this claim.
    client.test_seed_claim_voter_power(&claim_id, &voter, &0i128);

    let result = client.try_vote_on_claim(&voter, &claim_id, &niffyinsure::types::VoteOption::Approve);
    assert_eq!(
        result,
        Err(Ok(ValidateError::CorruptSnapshotEntry))
    );
}

#[test]
fn negative_snapshot_entry_reverts_vote() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);
    let voter = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    seed(&client, &voter, 1_000_000, 10_000);

    let details = String::from_str(&env, "negative snapshot test");
    let urls = vec![&env];
    let claim_id = client.file_claim(&holder, &1u32, &100_000i128, &details, &urls, &None);

    client.test_seed_claim_voter_power(&claim_id, &voter, &-5i128);

    let result = client.try_vote_on_claim(&voter, &claim_id, &niffyinsure::types::VoteOption::Approve);
    assert_eq!(
        result,
        Err(Ok(ValidateError::CorruptSnapshotEntry))
    );
}

#[test]
fn normal_voting_with_valid_entries_unaffected() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);
    let voter = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    seed(&client, &voter, 1_000_000, 10_000);

    let details = String::from_str(&env, "normal vote");
    let urls = vec![&env];
    let claim_id = client.file_claim(&holder, &1u32, &100_000i128, &details, &urls, &None);

    // No override seeded — normal vote weight computation is used.
    let status = client.vote_on_claim(&voter, &claim_id, &niffyinsure::types::VoteOption::Approve);
    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.approve_votes, 1);
    let _ = status;
}
