//! Tests for `get_policies_by_status`:
//!   - status filter correctness (Active, Expired, Terminated)
//!   - pagination boundary conditions
//!   - index consistency after status transitions
//!   - page size validation

#![cfg(test)]

use niffyinsure::types::{PolicyStatus, POLICIES_BY_STATUS_PAGE_SIZE_MAX, TerminationReason};
use niffyinsure::{validate::Error as ValidateError, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, IntoVal, Vec,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

/// Seed an active policy with end_ledger far in the future.
fn seed_active(
    env: &Env,
    client: &NiffyInsureClient<'static>,
    holder: &Address,
    policy_id: u32,
) {
    let far_future = env.ledger().sequence() + 100_000;
    client.test_seed_policy(holder, &policy_id, &1_000_000i128, &far_future);
}

// ── Status filter correctness ──────────────────────────────────────────────

#[test]
fn get_policies_by_status_empty() {
    let (env, client, _, _) = setup();

    let active = client.get_policies_by_status(&PolicyStatus::Active, &0, &10);
    assert_eq!(active.len(), 0u32, "no policies → empty Active");

    let expired = client.get_policies_by_status(&PolicyStatus::Expired, &0, &10);
    assert_eq!(expired.len(), 0u32, "no policies → empty Expired");

    let terminated = client.get_policies_by_status(&PolicyStatus::Terminated, &0, &10);
    assert_eq!(terminated.len(), 0u32, "no policies → empty Terminated");
}

#[test]
fn get_policies_by_status_active_only() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);

    seed_active(&env, &client, &holder, 1);
    seed_active(&env, &client, &holder, 2);

    let active = client.get_policies_by_status(&PolicyStatus::Active, &0, &10);
    assert_eq!(active.len(), 2u32, "both policies are Active");

    let expired = client.get_policies_by_status(&PolicyStatus::Expired, &0, &10);
    assert_eq!(expired.len(), 0u32, "no Expired policies");

    // Verify summary fields.
    assert_eq!(active.get(0).unwrap().policy_id, 1u32);
    assert!(active.get(0).unwrap().is_active);
    assert_eq!(active.get(1).unwrap().policy_id, 2u32);
    assert!(active.get(1).unwrap().is_active);
}

#[test]
fn get_policies_by_status_expired_by_ledger() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);

    // Create policies with end_ledger=1 (start_ledger=1, so window [1,1) is empty).
    // At ledger 0 they're already past their active window.
    client.test_seed_policy(&holder, &1, &1_000_000i128, &1u32);
    client.test_seed_policy(&holder, &2, &1_000_000i128, &1u32);

    let active = client.get_policies_by_status(&PolicyStatus::Active, &0, &10);
    assert_eq!(active.len(), 0u32, "no Active policies (window already closed)");

    let expired = client.get_policies_by_status(&PolicyStatus::Expired, &0, &10);
    assert_eq!(expired.len(), 2u32, "both policies are Expired by ledger truth");
}

#[test]
fn get_policies_by_status_expired_by_keeper() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);

    // Create an active policy, then advance ledger past end_ledger + grace.
    seed_active(&env, &client, &holder, 1);
    let far_end = env.ledger().sequence() + 100_000;
    // Override end_ledger to be just 1 so we can expire it.
    // Actually, let's just use the approach of setting ledger past the end.
    // We need the policy to be fully lapsed: now >= end_ledger + grace_period.
    let grace = 17_280; // DEFAULT_GRACE_PERIOD_LEDGERS
    env.ledger().set_with(|info| {
        info.sequence = far_end + grace + 1;
        info.timestamp = 12345;
    });

    client.process_expired(&holder, &1);

    let active = client.get_policies_by_status(&PolicyStatus::Active, &0, &10);
    assert_eq!(active.len(), 0u32, "no Active after process_expired");

    let expired = client.get_policies_by_status(&PolicyStatus::Expired, &0, &10);
    assert_eq!(expired.len(), 1u32, "one Expired after keeper processed it");
}

#[test]
fn get_policies_by_status_terminated() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);

    // Create active policies, then terminate.
    seed_active(&env, &client, &holder, 10);
    seed_active(&env, &client, &holder, 11);

    client.terminate_policy(
        &holder,
        &10,
        &TerminationReason::VoluntaryCancellation,
    );

    let active = client.get_policies_by_status(&PolicyStatus::Active, &0, &10);
    assert_eq!(active.len(), 1u32, "one Active (policy 11)");
    assert_eq!(active.get(0).unwrap().policy_id, 11u32);

    let terminated = client.get_policies_by_status(&PolicyStatus::Terminated, &0, &10);
    assert_eq!(terminated.len(), 1u32, "one Terminated (policy 10)");
    assert_eq!(terminated.get(0).unwrap().policy_id, 10u32);
}

#[test]
fn get_policies_by_status_mixed() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);

    // Policy 1: Active (far future end_ledger).
    seed_active(&env, &client, &holder, 1);
    // Policy 2: Expired by ledger (end < now at ledger 0).
    client.test_seed_policy(&holder, &2, &1_000_000i128, &1u32);
    // Policy 3: Active, then terminate.
    seed_active(&env, &client, &holder, 3);
    // Policy 4: Active, then admin_terminate.
    seed_active(&env, &client, &holder, 4);

    client.terminate_policy(&holder, &3, &TerminationReason::VoluntaryCancellation);
    let admin = Address::generate(&env);
    client.admin_terminate_policy(
        &admin,
        &holder,
        &4,
        &TerminationReason::AdminOverride,
        &false,
    );

    let active = client.get_policies_by_status(&PolicyStatus::Active, &0, &10);
    assert_eq!(active.len(), 1u32, "only policy 1 is Active");
    assert_eq!(active.get(0).unwrap().policy_id, 1u32);

    // Policy 2 is expired-by-ledger (end_ledger=1, now=0, window [1,1) is empty).
    let expired = client.get_policies_by_status(&PolicyStatus::Expired, &0, &10);
    assert_eq!(expired.len(), 1u32, "policy 2 is Expired by ledger truth");

    let terminated = client.get_policies_by_status(&PolicyStatus::Terminated, &0, &10);
    assert_eq!(terminated.len(), 2u32, "policies 3 & 4 are Terminated");
}

// ── Pagination boundary conditions ─────────────────────────────────────────

#[test]
fn get_policies_by_status_pagination_first_page() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);

    // Seed 5 active policies.
    for i in 1..=5u32 {
        seed_active(&env, &client, &holder, i);
    }

    let page = client.get_policies_by_status(&PolicyStatus::Active, &0, &3);
    assert_eq!(page.len(), 3u32, "first page of 3");
    assert_eq!(page.get(0).unwrap().policy_id, 1u32);
    assert_eq!(page.get(1).unwrap().policy_id, 2u32);
    assert_eq!(page.get(2).unwrap().policy_id, 3u32);
}

#[test]
fn get_policies_by_status_pagination_second_page() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);

    for i in 1..=5u32 {
        seed_active(&env, &client, &holder, i);
    }

    let page = client.get_policies_by_status(&PolicyStatus::Active, &3, &3);
    assert_eq!(page.len(), 2u32, "second page has the remaining 2");
    assert_eq!(page.get(0).unwrap().policy_id, 4u32);
    assert_eq!(page.get(1).unwrap().policy_id, 5u32);
}

#[test]
fn get_policies_by_status_pagination_exact_page() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);

    // Exactly page-size active policies.
    for i in 1..=POLICIES_BY_STATUS_PAGE_SIZE_MAX {
        seed_active(&env, &client, &holder, i);
    }

    let page = client.get_policies_by_status(
        &PolicyStatus::Active,
        &0,
        &POLICIES_BY_STATUS_PAGE_SIZE_MAX,
    );
    assert_eq!(
        page.len(),
        POLICIES_BY_STATUS_PAGE_SIZE_MAX,
        "page equals the hard cap"
    );

    // Offset past the end should be empty.
    let empty = client.get_policies_by_status(
        &PolicyStatus::Active,
        &POLICIES_BY_STATUS_PAGE_SIZE_MAX,
        &1,
    );
    assert_eq!(empty.len(), 0u32, "offset past end → empty");
}

#[test]
fn get_policies_by_status_pagination_offset_zero_limit_zero() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);

    seed_active(&env, &client, &holder, 1);

    let page = client.get_policies_by_status(&PolicyStatus::Active, &0, &0);
    assert_eq!(page.len(), 0u32, "limit=0 returns nothing");
}

#[test]
fn get_policies_by_status_page_size_too_large() {
    let (env, client, _, _) = setup();

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.get_policies_by_status(
            &PolicyStatus::Active,
            &0,
            &(POLICIES_BY_STATUS_PAGE_SIZE_MAX + 1),
        );
    }));

    assert!(result.is_err(), "page size > cap must panic");
}

// ── Index consistency on transitions ───────────────────────────────────────

#[test]
fn get_policies_by_status_after_admin_terminate() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let admin = Address::generate(&env);

    seed_active(&env, &client, &holder, 1);
    client.admin_terminate_policy(
        &admin,
        &holder,
        &1,
        &TerminationReason::RegulatoryAction,
        &false,
    );

    let active = client.get_policies_by_status(&PolicyStatus::Active, &0, &10);
    assert_eq!(active.len(), 0u32, "no Active after admin terminate");

    let terminated = client.get_policies_by_status(&PolicyStatus::Terminated, &0, &10);
    assert_eq!(terminated.len(), 1u32, "one Terminated after admin terminate");
    assert_eq!(terminated.get(0).unwrap().policy_id, 1u32);
}

#[test]
fn get_policies_by_status_after_holder_terminate() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);

    seed_active(&env, &client, &holder, 1);
    seed_active(&env, &client, &holder, 2);

    // Terminate one.
    client.terminate_policy(&holder, &1, &TerminationReason::VoluntaryCancellation);

    let active = client.get_policies_by_status(&PolicyStatus::Active, &0, &10);
    assert_eq!(active.len(), 1u32, "one Active remains");
    assert_eq!(active.get(0).unwrap().policy_id, 2u32);

    let terminated = client.get_policies_by_status(&PolicyStatus::Terminated, &0, &10);
    assert_eq!(terminated.len(), 1u32, "one Terminated");
    assert_eq!(terminated.get(0).unwrap().policy_id, 1u32);
}

#[test]
fn get_policies_by_status_multiple_holders() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    seed_active(&env, &client, &alice, 1);
    client.test_seed_policy(&bob, &10, &1_000_000i128, &1u32);

    // All policies across all holders should appear in their respective status indices.
    let active = client.get_policies_by_status(&PolicyStatus::Active, &0, &10);
    assert_eq!(active.len(), 1u32, "one Active across all holders");
    assert_eq!(active.get(0).unwrap().policy_id, 1u32);

    let expired = client.get_policies_by_status(&PolicyStatus::Expired, &0, &10);
    assert_eq!(expired.len(), 1u32, "one Expired across all holders");
    assert_eq!(expired.get(0).unwrap().policy_id, 10u32);

    // Both statuses sum to total policies (2).
    let total = active.len() + expired.len();
    let terminated = client.get_policies_by_status(&PolicyStatus::Terminated, &0, &10);
    assert_eq!(total + terminated.len(), 2u32, "all 2 policies accounted");
}