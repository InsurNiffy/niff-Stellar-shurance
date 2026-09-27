//! Tests for Issue #842: Ledger close time estimation helper.
//! Tests for Issue #804: estimate_close_time entrypoint (wall-clock estimation).

#![cfg(test)]

use niffyinsure::NiffyInsureClient;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{Address, Env};

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

fn setup_with_ledger(
    timestamp: u64,
    sequence: u32,
) -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.timestamp = timestamp;
        l.sequence_number = sequence;
    });
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin)
}

#[test]
fn default_estimate_is_five() {
    let (_env, client, _admin) = setup();
    // Default should be 5 (SECS_PER_LEDGER constant) when unset
    assert_eq!(client.get_ledger_close_time_estimate(), 5u32);
}

#[test]
fn admin_can_update_estimate() {
    let (_env, client, _admin) = setup();
    client.admin_set_ledger_close_secs(&7u32);
    assert_eq!(client.get_ledger_close_time_estimate(), 7u32);
}

#[test]
fn get_estimate_is_read_only_no_state_mutation() {
    let (_env, client, _admin) = setup();
    // Calling get multiple times returns the same value without side effects
    assert_eq!(client.get_ledger_close_time_estimate(), 5u32);
    assert_eq!(client.get_ledger_close_time_estimate(), 5u32);
}

#[test]
fn estimate_zero_is_rejected() {
    let (_env, client, _admin) = setup();
    assert!(client.try_admin_set_ledger_close_secs(&0u32).is_err());
}

#[test]
fn estimate_above_thirty_is_rejected() {
    let (_env, client, _admin) = setup();
    assert!(client.try_admin_set_ledger_close_secs(&31u32).is_err());
}

#[test]
fn estimate_at_boundary_is_accepted() {
    let (_env, client, _admin) = setup();
    client.admin_set_ledger_close_secs(&1u32);
    assert_eq!(client.get_ledger_close_time_estimate(), 1u32);
    client.admin_set_ledger_close_secs(&30u32);
    assert_eq!(client.get_ledger_close_time_estimate(), 30u32);
}

// ── Issue #804: estimate_close_time ─────────────────────────────────────────

#[test]
fn estimate_future_ledger_positive_delta() {
    // current_timestamp = 1_700_000_000, current_ledger = 100
    // target_ledger = 200 (100 ledgers ahead), secs_per_ledger = 5
    // expected = 1_700_000_000 + 100 * 5 = 1_700_000_500
    let (_env, client, _admin) = setup_with_ledger(1_700_000_000, 100);
    assert_eq!(client.estimate_close_time(&200), 1_700_000_500);
}

#[test]
fn estimate_with_custom_secs_per_ledger() {
    // admin sets 7 s/ledger, current_timestamp = 2_000_000_000, current_ledger = 50
    // target_ledger = 150 (100 ahead), expected = 2_000_000_000 + 100 * 7 = 2_000_000_700
    let (_env, client, _admin) = setup_with_ledger(2_000_000_000, 50);
    client.admin_set_ledger_close_secs(&7u32);
    assert_eq!(client.estimate_close_time(&150), 2_000_000_700);
}

#[test]
fn estimate_target_equals_current_returns_current_timestamp() {
    let (_env, client, _admin) = setup_with_ledger(1_700_000_000, 100);
    assert_eq!(client.estimate_close_time(&100), 1_700_000_000);
}

#[test]
fn estimate_past_target_returns_current_timestamp() {
    let (_env, client, _admin) = setup_with_ledger(1_700_000_000, 100);
    // target_ledger = 50 is behind current_ledger = 100
    assert_eq!(client.estimate_close_time(&50), 1_700_000_000);
}

#[test]
fn estimate_large_delta_no_overflow() {
    // Use the max secs_per_ledger (30) and a large but realistic delta
    // to verify u64 multiplication does not overflow.
    let (_env, client, _admin) = setup_with_ledger(1_700_000_000, 1);
    client.admin_set_ledger_close_secs(&30u32);
    // target_ledger = 4_000_000_000, delta = 3_999_999_999
    // delta * 30 = 119_999_999_970, timestamp + delta = 121_699_999_970
    // well within u64::MAX range (~1.8e19)
    let result = client.estimate_close_time(&4_000_000_000u32);
    assert!(result > 1_700_000_000);
    // Verify arithmetic: 1_700_000_000 + 3_999_999_999 * 30
    assert_eq!(result, 1_700_000_000u64 + 3_999_999_999u64 * 30u64);
}

#[test]
fn estimate_uses_stored_secs_per_ledger_not_hardcoded_five() {
    // Verify the entrypoint reads from storage, not the compile-time constant.
    // Set to 10, current=100, target=200 (100 ahead), timestamp=1_000_000_000
    // expected = 1_000_000_000 + 100 * 10 = 1_000_001_000
    let (_env, client, _admin) = setup_with_ledger(1_000_000_000, 100);
    client.admin_set_ledger_close_secs(&10u32);
    assert_eq!(client.estimate_close_time(&200), 1_000_001_000);
    // If it wrongly used constant 5: 1_000_000_000 + 100 * 5 = 1_000_000_500
    assert_ne!(client.estimate_close_time(&200), 1_000_000_500);
}