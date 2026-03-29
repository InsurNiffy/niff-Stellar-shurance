//! `PolicyExpired` event: keeper `process_expired` and `renew_policy` on expired policies.
//!
//! The Soroban test `Client` surfaces contract errors as `Err(Ok(PolicyError))` for `try_*`
//! helpers. Expired renewals return `Ok(Ok(Lapsed))` so state commits. Idempotency is asserted
//! via on-chain `get_pol_exp_evt_end_ledger` (authoritative for “exactly once per term”).

#![cfg(test)]

use niffyinsure::{
    types::{AgeBand, CoverageType, PolicyType, RegionTier, RenewPolicyOutcome},
    NiffyInsureClient, PolicyError,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, InvokeError,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.sequence_number = 100;
    });
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

fn assert_try_result_contains(r: impl core::fmt::Debug, needle: &str) {
    let s = format!("{r:?}");
    assert!(s.contains(needle), "expected {needle} in {s}");
}

fn assert_try_renew_fails_with(
    r: Result<
        Result<RenewPolicyOutcome, soroban_sdk::ConversionError>,
        Result<PolicyError, InvokeError>,
    >,
    needle: &str,
) {
    match r {
        Err(Ok(e)) => {
            let s = format!("{e:?}");
            assert!(s.contains(needle), "expected {needle} in {s}");
        }
        Ok(Ok(RenewPolicyOutcome::Lapsed)) => panic!("expected renew to fail (needle: {needle})"),
        Ok(Ok(RenewPolicyOutcome::Renewed(_))) => {
            panic!("expected renew to fail (needle: {needle})")
        }
        Ok(Err(conv)) => panic!("unexpected conversion error: {conv:?}"),
        Err(Err(host)) => panic!("unexpected SDK error: {host:?}"),
    }
}

fn assert_try_renew_lapsed(
    r: Result<
        Result<RenewPolicyOutcome, soroban_sdk::ConversionError>,
        Result<PolicyError, InvokeError>,
    >,
) {
    match r {
        Ok(Ok(RenewPolicyOutcome::Lapsed)) => {}
        Ok(Ok(RenewPolicyOutcome::Renewed(_))) => panic!("expected Lapsed, got Renewed"),
        Ok(Err(conv)) => panic!("unexpected conversion error: {conv:?}"),
        Err(Ok(e)) => panic!("expected Lapsed, got contract err: {e:?}"),
        Err(Err(host)) => panic!("unexpected SDK error: {host:?}"),
    }
}

#[test]
fn process_expired_reverts_when_policy_missing() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    assert_try_result_contains(client.try_process_expired(&holder, &1u32), "NotFound");
}

#[test]
fn process_expired_reverts_before_end_ledger() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &500u32);
    env.ledger().with_mut(|l| {
        l.sequence_number = 400;
    });
    assert_try_result_contains(
        client.try_process_expired(&holder, &1u32),
        "NotYetExpired",
    );
}

#[test]
fn process_expired_records_once_at_end_ledger() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &500u32);
    env.ledger().with_mut(|l| {
        l.sequence_number = 500;
    });

    assert_eq!(client.get_pol_exp_evt_end_ledger(&holder, &1u32), None);
    client.process_expired(&holder, &1u32);
    assert_eq!(
        client.get_pol_exp_evt_end_ledger(&holder, &1u32),
        Some(500u32)
    );

    client.process_expired(&holder, &1u32);
    assert_eq!(
        client.get_pol_exp_evt_end_ledger(&holder, &1u32),
        Some(500u32)
    );
}

#[test]
fn process_expired_records_once_when_observed_after_expiry_ledger() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &500u32);
    env.ledger().with_mut(|l| {
        l.sequence_number = 900;
    });

    client.process_expired(&holder, &1u32);
    assert_eq!(
        client.get_pol_exp_evt_end_ledger(&holder, &1u32),
        Some(500u32)
    );
}

#[test]
fn renew_when_expired_records_notice_once() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &400u32);
    token::StellarAssetClient::new(&env, &token).mint(&holder, &100_000_000i128);
    token::Client::new(&env, &token).approve(
        &holder,
        &client.address,
        &100_000_000i128,
        &(900u32),
    );

    env.ledger().with_mut(|l| {
        l.sequence_number = 400;
    });

    assert_try_renew_lapsed(client.try_renew_policy(
        &holder,
        &1u32,
        &AgeBand::Adult,
        &CoverageType::Standard,
        &80u32,
    ));
    assert_eq!(
        client.get_pol_exp_evt_end_ledger(&holder, &1u32),
        Some(400u32)
    );

    assert_try_renew_lapsed(client.try_renew_policy(
        &holder,
        &1u32,
        &AgeBand::Adult,
        &CoverageType::Standard,
        &80u32,
    ));
    assert_eq!(
        client.get_pol_exp_evt_end_ledger(&holder, &1u32),
        Some(400u32)
    );
}

#[test]
fn renew_succeeds_in_window_and_new_term_can_expire() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &2_000u32);

    token::StellarAssetClient::new(&env, &token).mint(&holder, &500_000_000i128);
    token::Client::new(&env, &token).approve(
        &holder,
        &client.address,
        &500_000_000i128,
        &(5_000u32),
    );

    env.ledger().with_mut(|l| {
        l.sequence_number = 1_500;
    });

    let p = match client.renew_policy(
        &holder,
        &1u32,
        &AgeBand::Adult,
        &CoverageType::Standard,
        &80u32,
    ) {
        RenewPolicyOutcome::Renewed(p) => p,
        RenewPolicyOutcome::Lapsed => panic!("expected renewed"),
    };
    assert!(p.end_ledger > 2_000u32);
    assert_eq!(client.get_pol_exp_evt_end_ledger(&holder, &1u32), None);

    env.ledger().with_mut(|l| {
        l.sequence_number = p.end_ledger;
    });
    client.process_expired(&holder, &1u32);
    assert_eq!(
        client.get_pol_exp_evt_end_ledger(&holder, &1u32),
        Some(p.end_ledger)
    );
}

#[test]
fn renew_rejects_when_open_claim() {
    let (env, client, admin, token) = setup();
    let holder = Address::generate(&env);
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &2_000u32);
    client.admin_set_open_claim_count(&admin, &holder, &1u32, &1u32);

    token::StellarAssetClient::new(&env, &token).mint(&holder, &500_000_000i128);
    token::Client::new(&env, &token).approve(
        &holder,
        &client.address,
        &500_000_000i128,
        &(5_000u32),
    );

    env.ledger().with_mut(|l| {
        l.sequence_number = 1_500;
    });

    assert_try_renew_fails_with(
        client.try_renew_policy(
            &holder,
            &1u32,
            &AgeBand::Adult,
            &CoverageType::Standard,
            &80u32,
        ),
        "OpenClaimBlocksRenewal",
    );
}

#[test]
fn initiate_then_process_expired_after_natural_duration() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    token::StellarAssetClient::new(&env, &token).mint(&holder, &10_000_000_000i128);
    token::Client::new(&env, &token).approve(
        &holder,
        &client.address,
        &10_000_000_000i128,
        &(6_312_000u32),
    );

    env.ledger().with_mut(|l| {
        l.sequence_number = 10_000;
    });
    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageType::Standard,
        &80u32,
        &1_000_000i128,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: None },
    );
    let end = policy.end_ledger;

    env.ledger().with_mut(|l| {
        l.sequence_number = end;
    });
    assert_eq!(
        client.get_pol_exp_evt_end_ledger(&holder, &policy.policy_id),
        None
    );
    client.process_expired(&holder, &policy.policy_id);
    assert_eq!(
        client.get_pol_exp_evt_end_ledger(&holder, &policy.policy_id),
        Some(end)
    );
}
