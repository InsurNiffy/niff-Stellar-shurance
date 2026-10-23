//! Boundary regression tests for Issue #1601 (batch query entrypoints).
//!
//! `get_policies_batch` already has dedicated boundary tests
//! (`tests/get_policies_batch.rs`), but `get_claims_batch` -- added at the
//! same time, capped at the same `CLAIM_BATCH_GET_MAX` (= 20) -- had no
//! dedicated coverage of the exact boundary the issue calls out: a batch of
//! exactly `MAX_BATCH_SIZE` must succeed, and `MAX_BATCH_SIZE + 1` must
//! revert with `ClaimBatchTooLarge` before any storage read.

#![cfg(test)]

mod common;

use niffyinsure::{types::CLAIM_BATCH_GET_MAX, validate::Error, NiffyInsureClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

fn setup() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin)
}

fn seed(client: &NiffyInsureClient, holder: &Address) {
    client.test_seed_policy(holder, &1u32, &1_000_000i128, &500_000u32);
}

fn file(client: &NiffyInsureClient, env: &Env, holder: &Address) -> u64 {
    let details = String::from_str(env, "batch boundary test");
    let ev = common::empty_evidence(env);
    client.file_claim(holder, &1u32, &100_000i128, &details, &ev, &None)
}

/// Exactly `CLAIM_BATCH_GET_MAX` ids must succeed and return one entry per id.
#[test]
fn get_claims_batch_at_exact_cap_succeeds() {
    let (env, client, _admin) = setup();
    let mut ids: Vec<u64> = Vec::new(&env);
    for _ in 0..CLAIM_BATCH_GET_MAX {
        let holder = Address::generate(&env);
        seed(&client, &holder);
        let cid = file(&client, &env, &holder);
        ids.push_back(cid);
    }

    let out = client.get_claims_batch(&ids);
    assert_eq!(out.len(), CLAIM_BATCH_GET_MAX);
    for entry in out.iter() {
        assert!(entry.is_some());
    }
}

/// `CLAIM_BATCH_GET_MAX + 1` ids reverts with `ClaimBatchTooLarge`, even
/// when every single id is otherwise valid.
#[test]
fn get_claims_batch_over_cap_reverts() {
    let (env, client, _admin) = setup();
    let mut ids: Vec<u64> = Vec::new(&env);
    for i in 0..(CLAIM_BATCH_GET_MAX + 1) {
        ids.push_back(i as u64);
    }

    let err = client.try_get_claims_batch(&ids).err().unwrap().unwrap();
    assert_eq!(err, Error::ClaimBatchTooLarge);
}

/// Empty input returns an empty vec rather than reverting.
#[test]
fn get_claims_batch_empty_input() {
    let (env, client, _admin) = setup();
    let ids: Vec<u64> = Vec::new(&env);
    let out = client.get_claims_batch(&ids);
    assert_eq!(out.len(), 0);
}

/// Missing claim ids are returned as `None` at their position, never cause
/// the whole batch call to revert.
#[test]
fn get_claims_batch_missing_ids_are_none() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder);
    let cid = file(&client, &env, &holder);

    let mut ids: Vec<u64> = Vec::new(&env);
    ids.push_back(cid);
    ids.push_back(9_999u64);

    let out = client.get_claims_batch(&ids);
    assert_eq!(out.len(), 2);
    assert!(out.get(0).unwrap().is_some());
    assert!(out.get(1).unwrap().is_none());
}
