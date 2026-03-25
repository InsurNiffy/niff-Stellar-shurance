#![cfg(test)]

use niffyinsure::{
    types::{PolicyType, RegionTier, TerminationReason},
    NiffyInsureClient,
};
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup_contract(env: &Env) -> (NiffyInsureClient<'_>, Address, Address) {
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token = Address::generate(env);
    client.initialize(&admin, &token);
    (client, admin, token)
}

#[test]
fn terminate_second_policy_drops_holder_from_voters_when_last_active() {
    let env = Env::default();
    let (client, _admin, _token) = setup_contract(&env);
    let holder = Address::generate(&env);

    let id1 = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &50_000_000i128,
        &10_000_000i128,
        &1000u32,
    );
    let id2 = client.initiate_policy(
        &holder,
        &PolicyType::Health,
        &RegionTier::High,
        &30_000_000i128,
        &5_000_000i128,
        &500u32,
    );

    assert_eq!(client.holder_active_policy_count(&holder), 2);
    assert!(client.voter_registry_contains(&holder));
    assert_eq!(client.voter_registry_len(), 1);

    assert!(client
        .try_terminate_policy(
            &holder,
            &id1,
            &TerminationReason::VoluntaryCancellation,
        )
        .unwrap()
        .is_ok());

    assert_eq!(client.holder_active_policy_count(&holder), 1);
    assert!(client.voter_registry_contains(&holder));

    assert!(client
        .try_terminate_policy(
            &holder,
            &id2,
            &TerminationReason::VoluntaryCancellation,
        )
        .unwrap()
        .is_ok());

    assert_eq!(client.holder_active_policy_count(&holder), 0);
    assert!(!client.voter_registry_contains(&holder));
    assert_eq!(client.voter_registry_len(), 0);
}

#[test]
fn terminate_one_of_two_policies_keeps_voter_status() {
    let env = Env::default();
    let (client, _admin, _token) = setup_contract(&env);
    let holder = Address::generate(&env);

    let id1 = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &50_000_000i128,
        &10_000_000i128,
        &800u32,
    );
    client.initiate_policy(
        &holder,
        &PolicyType::Property,
        &RegionTier::Medium,
        &20_000_000i128,
        &8_000_000i128,
        &800u32,
    );

    assert!(client
        .try_terminate_policy(
            &holder,
            &id1,
            &TerminationReason::VoluntaryCancellation,
        )
        .unwrap()
        .is_ok());

    assert_eq!(client.holder_active_policy_count(&holder), 1);
    assert!(client.voter_registry_contains(&holder));
    assert_eq!(client.voter_registry_len(), 1);
}

#[test]
fn cannot_terminate_policy_under_wrong_holder_address() {
    let env = Env::default();
    let (client, _admin, _token) = setup_contract(&env);
    let holder = Address::generate(&env);
    let other = Address::generate(&env);

    let id1 = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &50_000_000i128,
        &10_000_000i128,
        &500u32,
    );

    // Policy ledger key is (holder, policy_id); another address cannot reach it.
    let err = client.try_terminate_policy(
        &other,
        &id1,
        &TerminationReason::VoluntaryCancellation,
    );
    assert!(err.is_err());
}

#[test]
fn non_admin_cannot_call_admin_terminate() {
    let env = Env::default();
    let (client, _admin, _token) = setup_contract(&env);
    let holder = Address::generate(&env);
    let fake_admin = Address::generate(&env);

    let id1 = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &50_000_000i128,
        &10_000_000i128,
        &500u32,
    );

    let err = client.try_admin_terminate_policy(
        &fake_admin,
        &holder,
        &id1,
        &TerminationReason::AdminOverride,
        &true,
    );
    assert!(err.is_err());
}

#[test]
fn open_claim_blocks_holder_terminate_until_cleared() {
    let env = Env::default();
    let (client, admin, _token) = setup_contract(&env);
    let holder = Address::generate(&env);

    let id1 = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &50_000_000i128,
        &10_000_000i128,
        &400u32,
    );

    client.admin_set_open_claim_count(&admin, &holder, &id1, &1u32);

    let blocked = client.try_terminate_policy(
        &holder,
        &id1,
        &TerminationReason::VoluntaryCancellation,
    );
    assert!(blocked.is_err());

    client.admin_set_open_claim_count(&admin, &holder, &id1, &0u32);

    assert!(client
        .try_terminate_policy(
            &holder,
            &id1,
            &TerminationReason::VoluntaryCancellation,
        )
        .unwrap()
        .is_ok());
}

#[test]
fn admin_may_bypass_open_claim_guard_when_explicitly_flagged() {
    let env = Env::default();
    let (client, admin, _token) = setup_contract(&env);
    let holder = Address::generate(&env);

    let id1 = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &50_000_000i128,
        &10_000_000i128,
        &300u32,
    );

    client.admin_set_open_claim_count(&admin, &holder, &id1, &2u32);

    let blocked = client.try_admin_terminate_policy(
        &admin,
        &holder,
        &id1,
        &TerminationReason::AdminOverride,
        &false,
    );
    assert!(blocked.is_err());

    assert!(client
        .try_admin_terminate_policy(
            &admin,
            &holder,
            &id1,
            &TerminationReason::AdminOverride,
            &true,
        )
        .unwrap()
        .is_ok());

    let p = client.get_policy(&holder, &id1).unwrap();
    assert!(!p.is_active);
    assert!(p.terminated_by_admin);
    assert_eq!(
        p.termination_reason,
        TerminationReason::AdminOverride
    );
}

#[test]
fn two_unrelated_holders_each_have_one_voter_slot() {
    let env = Env::default();
    let (client, _admin, _token) = setup_contract(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    client.initiate_policy(
        &a,
        &PolicyType::Auto,
        &RegionTier::Low,
        &40_000_000i128,
        &9_000_000i128,
        &400u32,
    );
    client.initiate_policy(
        &b,
        &PolicyType::Health,
        &RegionTier::Medium,
        &35_000_000i128,
        &8_000_000i128,
        &400u32,
    );

    assert_eq!(client.voter_registry_len(), 2);
    assert!(client.voter_registry_contains(&a));
    assert!(client.voter_registry_contains(&b));
}

#[test]
fn double_terminate_fails() {
    let env = Env::default();
    let (client, _admin, _token) = setup_contract(&env);
    let holder = Address::generate(&env);

    let id1 = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &50_000_000i128,
        &10_000_000i128,
        &200u32,
    );

    assert!(client
        .try_terminate_policy(
            &holder,
            &id1,
            &TerminationReason::VoluntaryCancellation,
        )
        .unwrap()
        .is_ok());
    let again = client.try_terminate_policy(
        &holder,
        &id1,
        &TerminationReason::VoluntaryCancellation,
    );
    assert!(again.is_err());
}
