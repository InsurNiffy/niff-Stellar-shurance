//! Policy lifecycle ordering: every valid transition succeeds and every
//! invalid ordering is rejected with a clear error.
//!
//! Documented state machine (policy exists × is_active):
//!
//! ```text
//!   (absent) ──initiate/seed──► Active
//!   Active   ──terminate──────► Inactive          (holder)
//!   Active   ──admin_terminate► Inactive          (admin)
//!   Active   ──process_expired► Inactive          (after end+grace)
//!   Active   ──renew──────────► Active            (in renewal window)
//!
//! Invalid (must fail):
//!   terminate / admin_terminate / renew / process_expired on absent policy
//!   terminate / admin_terminate on already-Inactive
//!   renew on Inactive (never active after terminate, or never initiated)
//!   terminate with TerminationReason::None
//!   process_expired before end+grace
//!   renew outside the renewal window
//! ```

#![cfg(test)]

use niffyinsure::{
    policy::PolicyError as RenewPolicyError,
    policy_lifecycle::PolicyError as LifecycleError,
    types::{AgeBand, CoverageTier, TerminationReason},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 1_000);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin)
}

fn seed_active(client: &NiffyInsureClient, holder: &Address, end_ledger: u32) {
    client.test_seed_policy(holder, &1u32, &1_000_000i128, &end_ledger);
}

fn try_renew(client: &NiffyInsureClient, holder: &Address) -> Result<(), RenewPolicyError> {
    client
        .try_renew_policy(
            holder,
            &1u32,
            &AgeBand::Adult,
            &CoverageTier::Standard,
            &50u32,
            &None,
            &None,
        )
        .map(|_| ())
        .map_err(|e| e.unwrap())
}

// ── Valid transitions ─────────────────────────────────────────────────────────

#[test]
fn valid_active_to_inactive_via_holder_terminate() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);
    // end_ledger <= now → pro-rata refund is 0 (no token transfer needed).
    seed_active(&client, &holder, 500);

    client.terminate_policy(&holder, &1u32, &TerminationReason::VoluntaryCancellation);

    let policy = client.get_policy(&holder, &1u32).unwrap();
    assert!(!policy.is_active);
    assert_eq!(
        policy.termination_reason,
        TerminationReason::VoluntaryCancellation
    );
}

#[test]
fn valid_active_to_inactive_via_admin_terminate() {
    let (env, client, admin) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder, 50_000);

    client.admin_terminate_policy(
        &admin,
        &holder,
        &1u32,
        &TerminationReason::AdminOverride,
        &false,
    );

    let policy = client.get_policy(&holder, &1u32).unwrap();
    assert!(!policy.is_active);
    assert!(policy.terminated_by_admin);
    assert_eq!(policy.termination_reason, TerminationReason::AdminOverride);
}

#[test]
fn valid_active_to_inactive_via_process_expired_after_grace() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);
    let end = 1_000u32;
    seed_active(&client, &holder, end);

    let grace = client.get_grace_period_ledgers();
    env.ledger()
        .with_mut(|l| l.sequence_number = end.saturating_add(grace));

    client.process_expired(&holder, &1u32);

    let policy = client.get_policy(&holder, &1u32).unwrap();
    assert!(
        !policy.is_active,
        "process_expired after end+grace must deactivate"
    );
    assert_eq!(
        policy.termination_reason,
        TerminationReason::LapsedNonPayment
    );
}

#[test]
fn valid_active_renew_in_window_via_test_helper() {
    // Full renew_policy collects premium via token transfer; the test helper
    // mirrors the storage transition Active → Active (extended end_ledger).
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);
    let end = 2_000u32;
    seed_active(&client, &holder, end);

    client.test_renew_policy(&holder, &1u32);

    let policy = client.get_policy(&holder, &1u32).unwrap();
    assert!(policy.is_active);
    assert!(policy.end_ledger > end, "renewal must extend end_ledger");
}

// ── Invalid: absent policy ────────────────────────────────────────────────────

#[test]
fn invalid_terminate_absent_policy() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);

    let err = client
        .try_terminate_policy(&holder, &1u32, &TerminationReason::VoluntaryCancellation)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, LifecycleError::PolicyNotFound);
}

#[test]
fn invalid_admin_terminate_absent_policy() {
    let (env, client, admin) = setup();
    let holder = Address::generate(&env);

    let err = client
        .try_admin_terminate_policy(
            &admin,
            &holder,
            &1u32,
            &TerminationReason::AdminOverride,
            &false,
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, LifecycleError::PolicyNotFound);
}

#[test]
fn invalid_renew_absent_policy() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);

    let err = try_renew(&client, &holder).unwrap_err();
    assert_eq!(err, RenewPolicyError::NotFound);
}

#[test]
fn invalid_process_expired_absent_policy() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);

    let err = client
        .try_process_expired(&holder, &1u32)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, RenewPolicyError::NotFound);
}

// ── Invalid: out-of-order on inactive / never-activated ───────────────────────

#[test]
fn invalid_terminate_already_terminated() {
    let (env, client, admin) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder, 50_000);

    client.admin_terminate_policy(
        &admin,
        &holder,
        &1u32,
        &TerminationReason::AdminOverride,
        &false,
    );

    let err = client
        .try_terminate_policy(&holder, &1u32, &TerminationReason::VoluntaryCancellation)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, LifecycleError::AlreadyInactive);
}

#[test]
fn invalid_admin_terminate_already_terminated() {
    let (env, client, admin) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder, 50_000);

    client.admin_terminate_policy(
        &admin,
        &holder,
        &1u32,
        &TerminationReason::AdminOverride,
        &false,
    );

    let err = client
        .try_admin_terminate_policy(
            &admin,
            &holder,
            &1u32,
            &TerminationReason::FraudOrMisrepresentation,
            &false,
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, LifecycleError::AlreadyInactive);
}

#[test]
fn invalid_renew_terminated_policy() {
    let (env, client, admin) = setup();
    let holder = Address::generate(&env);
    // end far enough that we are still inside a theoretical renewal window,
    // so the inactive check (not WindowClosed) is what must fire.
    seed_active(&client, &holder, 50_000);

    client.admin_terminate_policy(
        &admin,
        &holder,
        &1u32,
        &TerminationReason::AdminOverride,
        &false,
    );

    let err = try_renew(&client, &holder).unwrap_err();
    assert_eq!(err, RenewPolicyError::PolicyInactive);
}

#[test]
fn invalid_renew_never_initiated_policy() {
    // "Never activated" ≡ no policy record (never initiated).
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);

    let err = try_renew(&client, &holder).unwrap_err();
    assert_eq!(err, RenewPolicyError::NotFound);
}

// ── Invalid: reason / window / sequencing guards ───────────────────────────────

#[test]
fn invalid_terminate_with_none_reason() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder, 500);

    let err = client
        .try_terminate_policy(&holder, &1u32, &TerminationReason::None)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, LifecycleError::InvalidTerminationReason);
}

#[test]
fn invalid_process_expired_before_lapse() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);
    let end = 5_000u32;
    seed_active(&client, &holder, end);
    // now (1000) << end — must not deactivate.
    let err = client
        .try_process_expired(&holder, &1u32)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, RenewPolicyError::NotYetExpired);

    let policy = client.get_policy(&holder, &1u32).unwrap();
    assert!(policy.is_active, "policy must remain active before lapse");
}

#[test]
fn invalid_renew_outside_window() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);
    // end far in the future → current ledger is before renewal window opens.
    seed_active(&client, &holder, 500_000);

    let err = try_renew(&client, &holder).unwrap_err();
    assert_eq!(err, RenewPolicyError::NotInRenewalWindow);
}

#[test]
fn invalid_admin_terminate_by_non_admin() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);
    let attacker = Address::generate(&env);
    seed_active(&client, &holder, 50_000);

    let err = client
        .try_admin_terminate_policy(
            &attacker,
            &holder,
            &1u32,
            &TerminationReason::AdminOverride,
            &false,
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, LifecycleError::Unauthorized);
}
