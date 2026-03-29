//! Tests targeting the ~24 lines not yet covered by other test files.
//!
//! Covers:
//!   - voter_registry_len / voter_registry_contains / holder_active_policy_count
//!   - get_active_policy_count
//!   - set_allowed_asset / is_allowed_asset
//!   - set_calculator / clear_calculator / get_calculator
//!   - set_sweep_cap / get_sweep_cap
//!   - quote_error_message for all remaining error codes

#![cfg(test)]

use niffyinsure::{validate::Error, NiffyInsureClient};
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let cid = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &cid);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

// ── voter registry helpers ────────────────────────────────────────────────────

#[test]
fn voter_registry_len_starts_at_zero() {
    let (_env, client, _, _) = setup();
    assert_eq!(client.voter_registry_len(), 0u32);
}

#[test]
fn voter_registry_len_increments_with_seeded_policies() {
    let (env, client, _, _) = setup();
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    client.test_seed_policy(&a, &1u32, &1_000_000i128, &10_000u32);
    assert_eq!(client.voter_registry_len(), 1u32);
    client.test_seed_policy(&b, &1u32, &1_000_000i128, &10_000u32);
    assert_eq!(client.voter_registry_len(), 2u32);
}

#[test]
fn voter_registry_contains_returns_false_for_unknown() {
    let (env, client, _, _) = setup();
    let stranger = Address::generate(&env);
    assert!(!client.voter_registry_contains(&stranger));
}

#[test]
fn voter_registry_contains_returns_true_after_seed() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &10_000u32);
    assert!(client.voter_registry_contains(&holder));
}

#[test]
fn holder_active_policy_count_zero_for_new_address() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    assert_eq!(client.holder_active_policy_count(&holder), 0u32);
}

#[test]
fn holder_active_policy_count_increments_per_seed() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &10_000u32);
    assert_eq!(client.holder_active_policy_count(&holder), 1u32);
    client.test_seed_policy(&holder, &2u32, &1_000_000i128, &10_000u32);
    assert_eq!(client.holder_active_policy_count(&holder), 2u32);
}

#[test]
fn get_active_policy_count_matches_holder_active_policy_count() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    client.test_seed_policy(&holder, &1u32, &500_000i128, &5_000u32);
    assert_eq!(
        client.get_active_policy_count(&holder),
        client.holder_active_policy_count(&holder)
    );
}

// ── asset allowlist ───────────────────────────────────────────────────────────

#[test]
fn token_is_allowed_after_initialize() {
    let (_env, client, _, token) = setup();
    assert!(client.is_allowed_asset(&token));
}

#[test]
fn set_allowed_asset_false_removes_from_allowlist() {
    let (_env, client, _, token) = setup();
    client.set_allowed_asset(&token, &false);
    assert!(!client.is_allowed_asset(&token));
}

#[test]
fn set_allowed_asset_true_adds_to_allowlist() {
    let (env, client, _, _) = setup();
    let new_asset = Address::generate(&env);
    assert!(!client.is_allowed_asset(&new_asset));
    client.set_allowed_asset(&new_asset, &true);
    assert!(client.is_allowed_asset(&new_asset));
}

// ── calculator address ────────────────────────────────────────────────────────

#[test]
fn get_calculator_returns_none_before_set() {
    let (_env, client, _, _) = setup();
    assert!(client.get_calculator().is_none());
}

#[test]
fn set_and_get_calculator_round_trip() {
    let (env, client, _, _) = setup();
    let calc = Address::generate(&env);
    client.set_calculator(&calc);
    assert_eq!(client.get_calculator(), Some(calc));
}

#[test]
fn clear_calculator_removes_address() {
    let (env, client, _, _) = setup();
    let calc = Address::generate(&env);
    client.set_calculator(&calc);
    assert!(client.get_calculator().is_some());
    client.clear_calculator();
    assert!(client.get_calculator().is_none());
}

// ── sweep cap ─────────────────────────────────────────────────────────────────

#[test]
fn get_sweep_cap_returns_none_by_default() {
    let (_env, client, _, _) = setup();
    assert!(client.get_sweep_cap().is_none());
}

#[test]
fn set_sweep_cap_and_get_round_trip() {
    let (_env, client, _, _) = setup();
    client.set_sweep_cap(&Some(5_000_000i128));
    assert_eq!(client.get_sweep_cap(), Some(5_000_000i128));
}

#[test]
fn set_sweep_cap_none_clears_cap() {
    let (_env, client, _, _) = setup();
    client.set_sweep_cap(&Some(1_000_000i128));
    client.set_sweep_cap(&None);
    assert!(client.get_sweep_cap().is_none());
}

// ── quote_error_message — remaining error codes ───────────────────────────────

#[test]
fn quote_error_message_covers_all_known_codes() {
    let (_env, client, _, _) = setup();

    // Every code that maps to a distinct Error variant in quote_error_message
    let codes: &[u32] = &[
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
        11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
        21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
        31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
        41, 42, 49,
    ];

    for &code in codes {
        let msg = client.quote_error_message(&code);
        assert_eq!(msg.code, code, "code mismatch for input {code}");
        assert!(!msg.message.is_empty(), "empty message for code {code}");
    }
}

#[test]
fn quote_error_message_unknown_code_returns_fallback() {
    let (_env, client, _, _) = setup();
    // Code 99 is not in the match — falls through to the default arm
    let msg = client.quote_error_message(&99u32);
    // Should not panic; returns some message
    assert!(!msg.message.is_empty());
}

// ── get_multiplier_table round-trip ──────────────────────────────────────────

#[test]
fn get_multiplier_table_returns_default_after_init() {
    let (_env, client, _, _) = setup();
    let table = client.get_multiplier_table();
    // Default table has entries — just verify it's non-empty / doesn't panic
    assert!(!table.region_multipliers.is_empty());
}
