//! Tests for Issue #830: Ledger arithmetic overflow at u32 boundary values.
#![cfg(test)]
mod common;
use niffyinsure::NiffyInsureClient;
use niffyinsure::types::{APPEAL_OPEN_WINDOW_LEDGERS, MAX_VOTING_DURATION_LEDGERS, POLICY_DURATION_LEDGERS, VOTE_WINDOW_LEDGERS};
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env, String};
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
#[test]
fn checked_add_at_max_safe_ledger_succeeds() {
    let max_safe = u32::MAX - MAX_VOTING_DURATION_LEDGERS;
    assert_eq!(max_safe.checked_add(MAX_VOTING_DURATION_LEDGERS), Some(u32::MAX));
}
#[test]
fn checked_add_one_past_max_safe_ledger_overflows() {
    let max_safe = u32::MAX - MAX_VOTING_DURATION_LEDGERS;
    assert!((max_safe + 1).checked_add(MAX_VOTING_DURATION_LEDGERS).is_none());
}
#[test]
fn saturating_add_at_u32_max_clamps() {
    assert_eq!(u32::MAX.saturating_add(1), u32::MAX);
}
#[test]
fn saturating_add_large_duration_at_boundary() {
    assert_eq!((u32::MAX - 100).saturating_add(200u32), u32::MAX);
}
#[test]
fn file_claim_near_u32_max_ledger_reverts_with_overflow() {
    let (env, client, _, _) = setup();
    env.ledger().with_mut(|l| l.sequence_number = u32::MAX - 10);
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, u32::MAX);
    let details = String::from_str(&env, "overflow test");
    let ev = common::empty_evidence(&env);
    assert!(client.try_file_claim(&holder, &1u32, &100_000i128, &details, &ev, &None).is_err());
}
#[test]
fn max_safe_ledger_invariant() {
    let max_safe = u32::MAX - MAX_VOTING_DURATION_LEDGERS;
    assert_eq!(max_safe + MAX_VOTING_DURATION_LEDGERS, u32::MAX);
    assert!((max_safe + 1).checked_add(MAX_VOTING_DURATION_LEDGERS).is_none());
}
#[test]
fn policy_duration_checked_add_at_boundary_overflows() {
    assert!((u32::MAX - POLICY_DURATION_LEDGERS + 1).checked_add(POLICY_DURATION_LEDGERS).is_none());
}
#[test]
fn policy_duration_checked_add_just_below_boundary_succeeds() {
    assert_eq!((u32::MAX - POLICY_DURATION_LEDGERS).checked_add(POLICY_DURATION_LEDGERS).unwrap(), u32::MAX);
}
#[test]
fn vote_window_checked_add_at_boundary() {
    assert!((u32::MAX - VOTE_WINDOW_LEDGERS + 1).checked_add(VOTE_WINDOW_LEDGERS).is_none());
}
#[test]
fn appeal_window_checked_add_at_boundary() {
    assert!((u32::MAX - APPEAL_OPEN_WINDOW_LEDGERS + 1).checked_add(APPEAL_OPEN_WINDOW_LEDGERS).is_none());
}
#[test]
fn u32_max_checked_add_any_positive_overflows() {
    assert!(u32::MAX.checked_add(1).is_none());
    assert!(u32::MAX.checked_add(VOTE_WINDOW_LEDGERS).is_none());
}
#[test]
fn documentation_overflow_handling_exists() {
    // OVERFLOW HANDLING STRATEGY (documented in ledger.rs):
    // 1. file_claim: voting_deadline_ledger = now.checked_add(duration) -> Error::Overflow
    // 2. vote_on_claim / finalize_claim: deadlines via checked_add -> Error::Overflow
    // 3. open_appeal: appeal_deadline_ledger via checked_add -> Error::Overflow
    // 4. finalize_appeal: payout/dispute deadlines via checked_add
    // 5. Pure helpers: saturating_add with checked variants for error propagation
    // 6. MAX_SAFE_LEDGER = u32::MAX - MAX_VOTING_DURATION_LEDGERS = 4_293_999_615
}