//! TTL semantics for `ClaimVoters` snapshots: vote errors vs refresh helper.

#![cfg(test)]

use niffyinsure::{
    storage::{self, DataKey},
    types::VoteOption,
    validate::Error as ValidateError,
    NiffyInsureClient,
};
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
    (env, client, contract_id)
}

fn seed(client: &NiffyInsureClient, holder: &Address, coverage: i128, end_ledger: u32) {
    client.test_seed_policy(holder, &1u32, &coverage, &end_ledger);
}

fn file(client: &NiffyInsureClient, holder: &Address, amount: i128, env: &Env) -> u64 {
    let details = String::from_str(env, "ttl test");
    let urls = vec![env];
    client.file_claim(holder, &1u32, &amount, &details, &urls)
}

/// Simulates Soroban archival of the snapshot entry (same observable effect as TTL expiry).
fn remove_snapshot_env(env: &Env, contract_id: &Address, claim_id: u64) {
    env.as_contract(contract_id, || {
        env.storage()
            .persistent()
            .remove(&DataKey::ClaimVoters(claim_id));
    });
}

#[test]
fn vote_reverts_voter_snapshot_expired_not_not_eligible_voter() {
    let (env, client, contract_id) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let cid = file(&client, &holder, 100_000, &env);

    remove_snapshot_env(&env, &contract_id, cid);

    let err = client
        .try_vote_on_claim(&holder, &cid, &VoteOption::Approve)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, ValidateError::VoterSnapshotExpired.into());
}

#[test]
fn refresh_snapshot_is_permissionless_and_preserves_tallies() {
    let (env, client, _contract_id) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 10_000);
    seed(&client, &v2, 1_000_000, 10_000);
    seed(&client, &v3, 1_000_000, 10_000);

    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);

    let before = client.get_claim(&cid);
    assert_eq!(before.approve_votes, 1);
    assert_eq!(before.reject_votes, 0);

    // Entrypoint is permissionless (no `require_auth`); invoker is irrelevant.
    client.refresh_snapshot(&cid);

    let after = client.get_claim(&cid);
    assert_eq!(after.approve_votes, 1);
    assert_eq!(after.reject_votes, 0);

    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);
    assert_eq!(client.get_claim(&cid).approve_votes, 1);
    assert_eq!(client.get_claim(&cid).reject_votes, 1);
}

#[test]
fn refresh_snapshot_errors_when_claim_missing() {
    let (_env, client, _) = setup();
    let err = client
        .try_refresh_snapshot(&999u64)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, ValidateError::ClaimNotFound.into());
}

#[test]
fn refresh_snapshot_errors_when_snapshot_gone() {
    let (env, client, contract_id) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let cid = file(&client, &holder, 100_000, &env);
    remove_snapshot_env(&env, &contract_id, cid);

    let err = client
        .try_refresh_snapshot(&cid)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, ValidateError::VoterSnapshotExpired.into());
}

#[test]
fn snapshot_uses_dedicated_ttl_constants() {
    let (env, client, contract_id) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let cid = file(&client, &holder, 50_000, &env);

    let has = env.as_contract(&contract_id, || storage::has_claim_voters(&env, cid));
    assert!(has, "snapshot must exist immediately after file_claim");
}
