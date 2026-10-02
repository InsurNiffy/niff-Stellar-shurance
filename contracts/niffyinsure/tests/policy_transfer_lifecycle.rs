//! #1435 / #1436 — Policy lifecycle batch expiry, transfer dual-auth, beneficiary payout.

#![cfg(test)]

use niffyinsure::{
    types::{
        AgeBand, ClaimStatus, CoverageTier, InitiatePolicyOptions, PolicyType, RegionTier,
        TerminationReason, VoteOption, PROCESS_EXPIRED_MAX,
    },
    validate::Error as ValidateError,
    NiffyInsureClient, PolicyError,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, vec, Address, Env, String,
};

const INITIAL_LEDGER: u32 = 1_000;
const STARTING_BALANCE: i128 = 10_000_000_000;

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = INITIAL_LEDGER);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

fn fund(env: &Env, client: &NiffyInsureClient<'_>, token: &Address, who: &Address) {
    token::StellarAssetClient::new(env, token).mint(who, &STARTING_BALANCE);
    token::Client::new(env, token).approve(
        who,
        &client.address,
        &STARTING_BALANCE,
        &(env.ledger().sequence() + 100_000),
    );
}

fn bind_policy(
    env: &Env,
    client: &NiffyInsureClient<'_>,
    token: &Address,
    holder: &Address,
) -> niffyinsure::types::Policy {
    fund(env, client, token, holder);
    client.initiate_policy(
        holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &50u32,
        &1_000_000i128,
        token,
        &InitiatePolicyOptions::test_defaults(env),
    )
}

#[test]
fn renew_outside_window_reverts() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    let policy = bind_policy(&env, &client, &token, &holder);
    let err = client
        .try_renew_policy(
            &holder,
            &policy.policy_id,
            &AgeBand::Adult,
            &CoverageTier::Standard,
            &50u32,
            &None,
            &None,
        )
        .map(|_| ())
        .map_err(|e| e.unwrap())
        .unwrap_err();
    assert_eq!(err, PolicyError::NotInRenewalWindow);
}

#[test]
fn terminate_with_open_claim_reverts() {
    let (env, client, admin, token) = setup();
    let holder = Address::generate(&env);
    let policy = bind_policy(&env, &client, &token, &holder);
    client.admin_set_open_claim_count(&admin, &holder, &policy.policy_id, &1u32);

    let err = client
        .try_terminate_policy(
            &holder,
            &policy.policy_id,
            &TerminationReason::VoluntaryCancellation,
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(
        err,
        niffyinsure::policy_lifecycle::PolicyError::OpenClaimsMustFinalize
    );
}

#[test]
fn terminate_without_open_claim_succeeds() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    let policy = bind_policy(&env, &client, &token, &holder);
    env.ledger()
        .with_mut(|l| l.sequence_number = policy.end_ledger);

    client.terminate_policy(
        &holder,
        &policy.policy_id,
        &TerminationReason::VoluntaryCancellation,
    );
    let stored = client.get_policy(&holder, &policy.policy_id).unwrap();
    assert!(!stored.is_active);
}

#[test]
fn process_expired_batch_idempotent_and_bounded() {
    let (env, client, _admin, _token) = setup();
    let holder = Address::generate(&env);
    let end = 1_200u32;
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &end);
    client.test_seed_policy(&holder, &2u32, &1_000_000i128, &end);

    let grace = client.get_grace_period_ledgers();
    env.ledger()
        .with_mut(|l| l.sequence_number = end.saturating_add(grace).saturating_add(1));

    let ids = vec![&env, 1u32, 2u32, 99u32];
    let n = client.process_expired(&holder, &ids);
    assert!(n >= 2);

    let n2 = client.process_expired(&holder, &ids);
    assert!(n2 >= 2);

    assert!(!client.get_policy(&holder, &1u32).unwrap().is_active);
    assert!(!client.get_policy(&holder, &2u32).unwrap().is_active);

    let mut many = soroban_sdk::Vec::new(&env);
    for i in 0..(PROCESS_EXPIRED_MAX + 5) {
        many.push_back(i);
    }
    let _ = client.process_expired(&holder, &many);
}

#[test]
fn transfer_with_open_claim_rejected() {
    let (env, client, admin, token) = setup();
    let holder = Address::generate(&env);
    let new_holder = Address::generate(&env);
    let policy = bind_policy(&env, &client, &token, &holder);
    client.admin_set_open_claim_count(&admin, &holder, &policy.policy_id, &1u32);

    let err = client
        .try_transfer_policy(&holder, &policy.policy_id, &new_holder)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ValidateError::PolicyTransferInvalid);
}

#[test]
fn transfer_updates_indexes_and_preserves_strikes() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    let new_holder = Address::generate(&env);
    let policy = bind_policy(&env, &client, &token, &holder);
    let old_strikes = policy.strike_count;
    let old_active = client.get_active_policy_count(&holder);

    client.transfer_policy(&holder, &policy.policy_id, &new_holder);

    assert!(client.get_policy(&holder, &policy.policy_id).is_none());
    let new_id = client.get_policy_counter(&new_holder);
    let moved = client.get_policy(&new_holder, &new_id).unwrap();
    assert_eq!(moved.holder, new_holder);
    assert_eq!(moved.strike_count, old_strikes);
    assert_eq!(moved.coverage, policy.coverage);
    assert!(moved.is_active);
    assert_eq!(
        client.get_active_policy_count(&holder),
        old_active.saturating_sub(1)
    );
    assert_eq!(client.get_active_policy_count(&new_holder), 1u32);
}

#[test]
fn transfer_inactive_rejected() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    let new_holder = Address::generate(&env);
    let policy = bind_policy(&env, &client, &token, &holder);
    env.ledger()
        .with_mut(|l| l.sequence_number = policy.end_ledger);
    client.terminate_policy(
        &holder,
        &policy.policy_id,
        &TerminationReason::VoluntaryCancellation,
    );

    let err = client
        .try_transfer_policy(&holder, &policy.policy_id, &new_holder)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ValidateError::PolicyInactive);
}

#[test]
fn beneficiary_receives_payout_integration() {
    let (env, client, _admin, token) = setup();
    token::StellarAssetClient::new(&env, &token).mint(&client.address, &500_000_000i128);

    let holder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    fund(&env, &client, &token, &holder);
    client.test_seed_policy(&voter1, &1u32, &1_000_000i128, &50_000u32);
    client.test_seed_policy(&voter2, &1u32, &1_000_000i128, &50_000u32);

    let mut o = InitiatePolicyOptions::test_defaults(&env);
    o.beneficiary = Some(beneficiary.clone());
    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &50u32,
        &1_000_000i128,
        &token,
        &o,
    );

    let details = String::from_str(&env, "beneficiary payout test");
    let evidence = vec![&env];
    let claim_id = client.file_claim(
        &holder,
        &policy.policy_id,
        &80_000i128,
        &details,
        &evidence,
        &None,
    );

    client.vote_on_claim(&voter1, &claim_id, &VoteOption::Approve);
    client.vote_on_claim(&voter2, &claim_id, &VoteOption::Approve);

    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.status, ClaimStatus::Approved);

    let before = token::Client::new(&env, &token).balance(&beneficiary);
    client.process_claim(&claim_id);
    let after = token::Client::new(&env, &token).balance(&beneficiary);
    assert_eq!(after, before + 80_000, "beneficiary must receive the payout");

    let paid = client.get_claim(&claim_id);
    assert_eq!(paid.status, ClaimStatus::Paid);
}

#[test]
fn admin_metadata_uri_rejects_bad_scheme() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    let policy = bind_policy(&env, &client, &token, &holder);
    let r = client.try_admin_update_policy_metadata_uri(
        &holder,
        &policy.policy_id,
        &String::from_str(&env, "ftp://bad"),
    );
    assert_eq!(r.unwrap_err().unwrap(), PolicyError::InvalidMetadataUri);
}
