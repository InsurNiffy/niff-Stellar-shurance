//! Per-holder replay-protection nonce tests.
//!
//! Covers:
//!   - get_nonce returns 0 for a fresh holder
//!   - Correct nonce passes; nonce increments after each mutating call
//!   - Mismatched nonce reverts deterministically
//!   - Gap attempt (skipping a nonce value) reverts
//!   - Nonce is independent per holder
//!   - Omitting expected_nonce (None) always succeeds regardless of current nonce
//!   - Nonce unchanged after failed file_claim on non-zero nonce
//!   - Nonce increments correctly across interleaved initiate_policy + file_claim calls

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{AgeBand, CoverageTier, InitiatePolicyOptions, PolicyType, RegionTier},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let cid = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &cid);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

fn fund(env: &Env, token: &Address, holder: &Address) {
    token::StellarAssetClient::new(env, token).mint(holder, &100_000_000i128);
}

fn initiate(
    env: &Env,
    client: &NiffyInsureClient,
    holder: &Address,
    token: &Address,
    nonce: Option<u64>,
) {
    fund(env, token, holder);
    token::Client::new(env, token).approve(
        holder,
        &client.address,
        &100_000_000i128,
        &(env.ledger().sequence() + 10_000),
    );
    client.initiate_policy(
        holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &10u32,
        &1_000_000i128,
        token,
        &InitiatePolicyOptions {
            expected_nonce: nonce,
            ..InitiatePolicyOptions::test_defaults(env)
        },
    );
}

#[allow(dead_code)]
fn file(
    client: &NiffyInsureClient,
    holder: &Address,
    policy_id: u32,
    env: &Env,
    nonce: Option<u64>,
) -> u64 {
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
    initiate(&env, &client, &holder, &token, None);
    // Nonce increments even when None is passed
    assert_eq!(client.get_nonce(&holder), 1u64);
}

// ── Correct nonce passes and increments ──────────────────────────────────────

#[test]
fn correct_nonce_passes_and_increments() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);

    assert_eq!(client.get_nonce(&holder), 0u64);
    initiate(&env, &client, &holder, &token, Some(0));
    assert_eq!(client.get_nonce(&holder), 1u64);

    // Second policy: nonce is now 1
    fund(&env, &token, &holder);
    token::Client::new(&env, &token).approve(
        &holder,
        &client.address,
        &100_000_000i128,
        &(env.ledger().sequence() + 10_000),
    );
    let result = client.try_initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &10u32,
        &1_000_000i128,
        &token,
        &InitiatePolicyOptions {
            expected_nonce: Some(1),
            ..InitiatePolicyOptions::test_defaults(&env)
        },
    );
    assert!(
        result.is_ok(),
        "expected_nonce=1 should pass after first call"
    );
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
        &InitiatePolicyOptions {
            expected_nonce: Some(1),
            ..InitiatePolicyOptions::test_defaults(&env)
        },
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

    initiate(&env, &client, &holder, &token, Some(0)); // nonce → 1
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
        &InitiatePolicyOptions {
            expected_nonce: Some(2),
            ..InitiatePolicyOptions::test_defaults(&env)
        },
    );
    assert!(result.is_err(), "gap nonce must revert");
    assert_eq!(
        client.get_nonce(&holder),
        1u64,
        "nonce must not change on revert"
    );
}

// ── Nonce is per-holder ───────────────────────────────────────────────────────

#[test]
fn nonce_is_independent_per_holder() {
    let (env, client, _, token) = setup();
    let h1 = Address::generate(&env);
    let h2 = Address::generate(&env);

    initiate(&env, &client, &h1, &token, Some(0)); // h1 nonce → 1
    initiate(&env, &client, &h1, &token, Some(1)); // h1 nonce → 2

    // h2 nonce is still 0
    assert_eq!(client.get_nonce(&h2), 0u64);
    initiate(&env, &client, &h2, &token, Some(0)); // h2 nonce → 1
    assert_eq!(client.get_nonce(&h1), 2u64);
    assert_eq!(client.get_nonce(&h2), 1u64);
}

// ── file_claim nonce mismatch reverts ─────────────────────────────────────────

#[test]
fn file_claim_wrong_nonce_reverts() {
    let (env, client, _, _token) = setup();
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
    let (env, client, _, _token) = setup();
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

// ── Wrong nonce on file_claim does not change a non-zero nonce ────────────────
//
// Regression: ensure the nonce is not partially written before the mismatch
// check fires, even when the holder already has a nonce > 0.

#[test]
fn file_claim_wrong_nonce_does_not_mutate_nonzero_nonce() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    let voter = Address::generate(&env);

    // Advance nonce to 2 via two successful initiate_policy calls.
    initiate(&env, &client, &holder, &token, Some(0)); // nonce → 1
    initiate(&env, &client, &holder, &token, Some(1)); // nonce → 2
    assert_eq!(client.get_nonce(&holder), 2u64);

    client.test_seed_policy(&holder, &3u32, &1_000_000i128, &200u32);
    client.test_seed_policy(&voter, &1u32, &1_000_000i128, &200u32);

    // Supply stale nonce 0 — must revert and leave nonce at 2.
    let details = String::from_str(&env, "stale nonce test");
    let ev = common::empty_evidence(&env);
    let result = client.try_file_claim(&holder, &3u32, &100_000i128, &details, &ev, &Some(0u64));
    assert!(result.is_err(), "stale nonce must revert");
    assert_eq!(
        client.get_nonce(&holder),
        2u64,
        "nonce must remain 2 after failed call"
    );
}

// ── Replay attack reproduction (Issue #1607) ──────────────────────────────────
//
// Simulates an attacker capturing a previously-submitted, successfully
// executed `file_claim` invocation (same holder, same expected_nonce) and
// resubmitting it verbatim to try to file a second, duplicate claim. The
// per-holder nonce must reject the replay even though every other argument
// is byte-identical to the original call.

#[test]
fn file_claim_replay_attack_is_rejected() {
    let (env, client, _, _token) = setup();
    let holder = Address::generate(&env);
    let voter = Address::generate(&env);

    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &200u32);
    client.test_seed_policy(&voter, &1u32, &1_000_000i128, &200u32);

    let details = String::from_str(&env, "replay test claim");
    let ev = common::empty_evidence(&env);

    // Original call: succeeds, consumes nonce 0.
    let claim_id =
        client.file_claim(&holder, &1u32, &100_000i128, &details, &ev, &Some(0u64));
    assert_eq!(claim_id, 1u64);
    assert_eq!(client.get_nonce(&holder), 1u64);

    // Attacker replays the exact same call (identical args, same expected_nonce
    // of 0) to try to file a duplicate claim. Must be rejected since the
    // on-chain nonce has already advanced to 1.
    let replay = client.try_file_claim(&holder, &1u32, &100_000i128, &details, &ev, &Some(0u64));
    assert!(replay.is_err(), "replayed file_claim must revert");
    // No second claim was created and the nonce did not move.
    assert_eq!(client.get_nonce(&holder), 1u64);
}

// ── Nonce increments correctly across interleaved initiate + file_claim ───────
//
// Both mutating entrypoints share the same per-holder counter; this test
// confirms the counter is a single monotonic sequence, not two separate ones.

#[test]
fn nonce_shared_across_initiate_and_file_claim() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    let voter = Address::generate(&env);

    // nonce 0 → initiate_policy
    initiate(&env, &client, &holder, &token, Some(0)); // nonce → 1
    assert_eq!(client.get_nonce(&holder), 1u64);

    // Seed a second policy directly so we can file a claim without a second initiate.
    client.test_seed_policy(&holder, &99u32, &1_000_000i128, &200u32);
    client.test_seed_policy(&voter, &1u32, &1_000_000i128, &200u32);

    // nonce 1 → file_claim (continues the same sequence)
    let details = String::from_str(&env, "interleaved nonce test");
    let ev = common::empty_evidence(&env);
    let claim_id = client.file_claim(&holder, &99u32, &100_000i128, &details, &ev, &Some(1u64));
    assert_eq!(claim_id, 1u64);
    assert_eq!(client.get_nonce(&holder), 2u64);

    // nonce 2 → another initiate_policy
    initiate(&env, &client, &holder, &token, Some(2)); // nonce → 3
    assert_eq!(client.get_nonce(&holder), 3u64);
}
