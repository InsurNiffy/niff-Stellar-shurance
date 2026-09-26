//! Ledger-based policy activity truth: `policy.is_active` is a stored flag
//! that must be flipped by an explicit write (termination, strike-threshold
//! deactivation, or the `process_expired` keeper). If that write is missed
//! or delayed, the flag and the `[start_ledger, end_ledger)` window can
//! disagree. Read entrypoints must resolve "is this policy active right
//! now" from the ledger window, not the possibly-stale flag.
//!
//! Covers both disagreement directions:
//!   - flag == true but the ledger window has already expired (most common:
//!     no keeper call has run yet).
//!   - flag == false but the ledger window is still open.
//!
//! In both cases `list_policies` and `get_inactive_policies` — the read
//! entrypoints backed by `ledger::is_policy_active_by_ledger` — must report
//! the ledger-truth answer, not the raw flag.

#![cfg(test)]

use niffyinsure::NiffyInsureClient;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 1);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin)
}

/// flag == true, window already expired (now >= end_ledger).
/// Read entrypoints must treat the policy as inactive despite the stale flag.
#[test]
fn flag_true_but_window_expired_reports_inactive() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);

    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &50u32);
    client.test_set_policy_flag_and_window(&holder, &1u32, &true, &1u32, &50u32);

    env.ledger().with_mut(|l| l.sequence_number = 100);

    // Raw stored flag is still true — proving the disagreement exists.
    let raw = client.get_policy(&holder, &1u32).unwrap();
    assert!(raw.is_active, "stored flag should still read true (not yet flipped by a keeper)");

    // But the ledger-truth read entrypoint must say inactive.
    let listed = client.list_policies(&holder, &0u32, &10u32);
    assert_eq!(listed.len(), 1);
    assert!(
        !listed.get(0).unwrap().is_active,
        "list_policies must report inactive from the ledger window, ignoring the stale flag"
    );

    let inactive = client.get_inactive_policies(&holder, &0u32, &10u32);
    assert_eq!(
        inactive.len(),
        1,
        "get_inactive_policies must surface the expired-but-flagged-active policy"
    );
}

/// flag == false, window still open (start <= now < end).
/// Read entrypoints must treat the policy as active despite the stale flag.
#[test]
fn flag_false_but_window_still_open_reports_active() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);

    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &10_000u32);
    client.test_set_policy_flag_and_window(&holder, &1u32, &false, &1u32, &10_000u32);

    env.ledger().with_mut(|l| l.sequence_number = 100);

    let raw = client.get_policy(&holder, &1u32).unwrap();
    assert!(!raw.is_active, "stored flag should still read false");

    let listed = client.list_policies(&holder, &0u32, &10u32);
    assert_eq!(listed.len(), 1);
    assert!(
        listed.get(0).unwrap().is_active,
        "list_policies must report active from the ledger window, ignoring the stale false flag"
    );

    let inactive = client.get_inactive_policies(&holder, &0u32, &10u32);
    assert_eq!(
        inactive.len(),
        0,
        "get_inactive_policies must not surface a policy whose window is still open"
    );
}

/// Boundary: now == end_ledger is expired (half-open window), regardless of flag.
#[test]
fn now_equal_to_end_ledger_is_expired_boundary() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);

    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &100u32);
    client.test_set_policy_flag_and_window(&holder, &1u32, &true, &1u32, &100u32);

    env.ledger().with_mut(|l| l.sequence_number = 100);

    let listed = client.list_policies(&holder, &0u32, &10u32);
    assert!(
        !listed.get(0).unwrap().is_active,
        "now == end_ledger must be treated as expired (half-open window)"
    );
}
