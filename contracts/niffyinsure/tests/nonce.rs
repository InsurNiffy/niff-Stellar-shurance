//! Per-holder replay-protection nonce tests.
//!
//! Covers:
//!   - get_nonce returns 0 for a fresh holder
//!   - Correct nonce passes; nonce increments after each mutating call
//!   - Mismatched nonce reverts deterministically
//!   - Gap attempt (skipping a nonce value) reverts
//!   - Nonce is independent per holder
//!   - Omitting expected_nonce (None) always succeeds regardless of current nonce

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{AgeBand, CoverageTier, InitiatePolicyOptions, PolicyType, RegionTier},
    NiffyInsureClient,
};
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env, String};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let cid = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &cid);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

fn initiate(client: &NiffyInsureClient, holder: &Address, token: &Address, nonce: Option<u64>) {
    client.initiate_policy(
        holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &10u32,
        &1_000_000i128,
        token,
        &InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: nonce },
    );
}

fn file(client: &NiffyInsureClient, holder: &Address, policy_id: u32, env: &Env, nonce: Option<u64>) -> u64 {
    let details = String::from_str(env, "nonce test claim");
    let ev = common::empty_evidence(env);
    client.file_claim(holder, &policy_id, &100_000i128, &details, &ev, &nonce)
}

// ── get_nonce starts at 0 ─────────────────────────────────────────────────────

#[test]
fn get_nonce_returns_zero_for_new_holder() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    assert_eq!(client.get_nonce(&holder), 0u64);
}

// ── None skips check; nonce stays at 0 ───────────────────────────────────────

#[test]
fn none_nonce_skips_check_and_increments() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    // No nonce supplied — should always succeed and still increment
    initiate(&client, &holder, &token, None);
    // Nonce increments even when None is passed
    assert_eq!(client.get_nonce(&holder), 1u64);
}

// ── Correct nonce passes and increments ──────────────────────────────────────

#[test]
fn correct_nonce_passes_and_increments() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);

    assert_eq!(client.get_nonce(&holder), 0u64);
    initiate(&client, &holder, &token, Some(0));
    assert_eq!(client.get_nonce(&holder), 1u64);

    // Second policy: nonce is now 1
    let result = client.try_initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &10u32,
        &1_000_000i128,
        &token,
        &InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: Some(1) },
    );
    assert!(result.is_ok(), "expected_nonce=1 should pass after first call");
    assert_eq!(client.get_nonce(&holder), 2u64);
}

// ── Mismatched nonce reverts ──────────────────────────────────────────────────

#[test]
fn mismatched_nonce_reverts() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);

    // Nonce is 0 but we supply 1 — should revert
    let result = client.try_initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &10u32,
        &1_000_000i128,
        &token,
        &InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: Some(1) },
    );
    assert!(result.is_err(), "wrong nonce must revert");
    // Nonce must not have changed
    assert_eq!(client.get_nonce(&holder), 0u64);
}

// ── Gap attempt reverts ───────────────────────────────────────────────────────

#[test]
fn gap_nonce_reverts() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);

    initiate(&client, &holder, &token, Some(0)); // nonce → 1
    assert_eq!(client.get_nonce(&holder), 1u64);

    // Skip nonce 1, try nonce 2 — should revert
    let result = client.try_initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &10u32,
        &1_000_000i128,
        &token,
        &InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: Some(2) },
    );
    assert!(result.is_err(), "gap nonce must revert");
    assert_eq!(client.get_nonce(&holder), 1u64, "nonce must not change on revert");
}

// ── Nonce is per-holder ───────────────────────────────────────────────────────

#[test]
fn nonce_is_independent_per_holder() {
    let (env, client, _, token) = setup();
    let h1 = Address::generate(&env);
    let h2 = Address::generate(&env);

    initiate(&client, &h1, &token, Some(0)); // h1 nonce → 1
    initiate(&client, &h1, &token, Some(1)); // h1 nonce → 2

    // h2 nonce is still 0
    assert_eq!(client.get_nonce(&h2), 0u64);
    initiate(&client, &h2, &token, Some(0)); // h2 nonce → 1
    assert_eq!(client.get_nonce(&h1), 2u64);
    assert_eq!(client.get_nonce(&h2), 1u64);
}

// ── file_claim nonce mismatch reverts ─────────────────────────────────────────

#[test]
fn file_claim_wrong_nonce_reverts() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    let voter = Address::generate(&env);

    // Seed a policy via test helper so we can file a claim
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &200u32);
    client.test_seed_policy(&voter, &1u32, &1_000_000i128, &200u32);

    // Nonce is 0; supply 1 — should revert
    let details = String::from_str(&env, "nonce test");
    let ev = common::empty_evidence(&env);
    let result = client.try_file_claim(&holder, &1u32, &100_000i128, &details, &ev, &Some(1u64));
    assert!(result.is_err(), "wrong nonce on file_claim must revert");
    assert_eq!(client.get_nonce(&holder), 0u64);
}

// ── file_claim correct nonce increments ──────────────────────────────────────

#[test]
fn file_claim_correct_nonce_increments() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    let voter = Address::generate(&env);

    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &200u32);
    client.test_seed_policy(&voter, &1u32, &1_000_000i128, &200u32);

    assert_eq!(client.get_nonce(&holder), 0u64);
    let details = String::from_str(&env, "nonce test");
    let ev = common::empty_evidence(&env);
    let claim_id = client.file_claim(&holder, &1u32, &100_000i128, &details, &ev, &Some(0u64));
    assert_eq!(claim_id, 1u64);
    assert_eq!(client.get_nonce(&holder), 1u64);
}
