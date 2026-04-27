//! Payout beneficiary: optional `Policy.beneficiary`, `set_beneficiary`, and `payout` routing.

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{AgeBand, Claim, ClaimStatus, CoverageTier, PolicyType, RegionTier},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};

fn setup() -> (
    Env,
    NiffyInsureClient<'static>,
    Address,
    Address,
    token::StellarAssetClient<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(issuer).address();
    let token_admin = token::StellarAssetClient::new(&env, &token_addr);
    client.initialize(&admin, &token_addr);
    (env, client, contract_id, token_addr, token_admin)
}

fn fund_and_approve(
    env: &Env,
    client: &NiffyInsureClient<'_>,
    token_addr: &Address,
    token_admin: &token::StellarAssetClient<'_>,
    holder: &Address,
) {
    token_admin.mint(holder, &10_000_000_000i128);
    token::Client::new(env, token_addr).approve(
        holder,
        &client.address,
        &10_000_000_000i128,
        &(env.ledger().sequence() + 10_000),
    );
}

fn initiate(
    client: &NiffyInsureClient<'_>,
    holder: &Address,
    token_addr: &Address,
    beneficiary: Option<Address>,
) -> niffyinsure::types::Policy {
    client.initiate_policy(
        holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &10u32,
        &1_000_000_000i128,
        token_addr,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: beneficiary, deductible: None, expected_nonce: None },
    )
}

fn inject_approved_claim(
    env: &Env,
    contract_id: &Address,
    claim_id: u64,
    policy: &niffyinsure::types::Policy,
    holder: &Address,
    token_addr: &Address,
    amount: i128,
) {
    let claim = Claim {
        claim_id,
        policy_id: policy.policy_id,
        claimant: holder.clone(),
        amount,
        deductible: 0,
        asset: token_addr.clone(),
        details: String::from_str(env, "test"),
        evidence: common::empty_evidence(env),
        status: ClaimStatus::Approved,
        voting_deadline_ledger: 1_000,
        approve_votes: 3,
        reject_votes: 0,
        filed_at: 100,
        appeal_open_deadline_ledger: 0,
        appeals_count: 0,
        appeal_deadline_ledger: 0,
        appeal_approve_votes: 0,
        appeal_reject_votes: 0,
        status_history: soroban_sdk::Vec::new(env),
    };
    env.as_contract(contract_id, || {
        niffyinsure::storage::set_claim(env, &claim);
    });
}

#[test]
fn payout_defaults_to_holder_when_beneficiary_unset() {
    let (env, client, contract_id, token_addr, token_admin) = setup();
    let holder = Address::generate(&env);
    fund_and_approve(&env, &client, &token_addr, &token_admin, &holder);
    token_admin.mint(&contract_id, &10_000_000i128);

    let policy = initiate(&client, &holder, &token_addr, None);
    assert!(policy.beneficiary.is_none());

    inject_approved_claim(
        &env,
        &contract_id,
        1,
        &policy,
        &holder,
        &token_addr,
        5_000_000,
    );

    let tok = token::Client::new(&env, &token_addr);
    let before = tok.balance(&holder);
    client.process_claim(&1u64);
    assert_eq!(tok.balance(&holder), before + 5_000_000i128);
}

#[test]
fn payout_routes_to_explicit_beneficiary_from_initiation() {
    let (env, client, contract_id, token_addr, token_admin) = setup();
    let holder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    fund_and_approve(&env, &client, &token_addr, &token_admin, &holder);
    token_admin.mint(&contract_id, &10_000_000i128);

    let policy = initiate(&client, &holder, &token_addr, Some(beneficiary.clone()));
    assert_eq!(policy.beneficiary, Some(beneficiary.clone()));

    inject_approved_claim(
        &env,
        &contract_id,
        1,
        &policy,
        &holder,
        &token_addr,
        5_000_000,
    );

    let tok = token::Client::new(&env, &token_addr);
    let before_ben = tok.balance(&beneficiary);
    let before_holder = tok.balance(&holder);
    client.process_claim(&1u64);
    assert_eq!(tok.balance(&beneficiary), before_ben + 5_000_000i128);
    assert_eq!(tok.balance(&holder), before_holder);
}

#[test]
fn set_beneficiary_updates_payout_destination() {
    let (env, client, contract_id, token_addr, token_admin) = setup();
    let holder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    fund_and_approve(&env, &client, &token_addr, &token_admin, &holder);
    token_admin.mint(&contract_id, &10_000_000i128);

    let policy = initiate(&client, &holder, &token_addr, None);
    client.set_beneficiary(&holder, &policy.policy_id, &Some(beneficiary.clone()));

    let updated = client.get_policy(&holder, &policy.policy_id).unwrap();
    assert_eq!(updated.beneficiary, Some(beneficiary.clone()));

    inject_approved_claim(
        &env,
        &contract_id,
        1,
        &updated,
        &holder,
        &token_addr,
        3_000_000,
    );

    let tok = token::Client::new(&env, &token_addr);
    let before_ben = tok.balance(&beneficiary);
    client.process_claim(&1u64);
    assert_eq!(tok.balance(&beneficiary), before_ben + 3_000_000i128);
}

#[test]
fn set_beneficiary_requires_holder_authorization() {
    let (env, client, _contract_id, token_addr, token_admin) = setup();
    let holder = Address::generate(&env);
    fund_and_approve(&env, &client, &token_addr, &token_admin, &holder);

    let policy = initiate(&client, &holder, &token_addr, None);

    env.mock_auths(&[]);
    assert!(client
        .try_set_beneficiary(&holder, &policy.policy_id, &None)
        .is_err());
}

#[test]
fn set_beneficiary_no_op_when_value_unchanged() {
    // Setting the same beneficiary twice must not revert and must leave the
    // stored value identical (idempotent).
    let (env, client, _contract_id, token_addr, token_admin) = setup();
    let holder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    fund_and_approve(&env, &client, &token_addr, &token_admin, &holder);

    let policy = initiate(&client, &holder, &token_addr, Some(beneficiary.clone()));
    // Call set_beneficiary with the same address — must succeed silently.
    client.set_beneficiary(&holder, &policy.policy_id, &Some(beneficiary.clone()));

    let updated = client.get_policy(&holder, &policy.policy_id).unwrap();
    assert_eq!(updated.beneficiary, Some(beneficiary));
}

#[test]
fn set_beneficiary_can_clear_back_to_none() {
    // After setting a beneficiary, clearing it (None) must route payouts back
    // to the holder.
    let (env, client, contract_id, token_addr, token_admin) = setup();
    let holder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    fund_and_approve(&env, &client, &token_addr, &token_admin, &holder);
    token_admin.mint(&contract_id, &10_000_000i128);

    let policy = initiate(&client, &holder, &token_addr, Some(beneficiary.clone()));
    // Clear the beneficiary.
    client.set_beneficiary(&holder, &policy.policy_id, &None);

    let updated = client.get_policy(&holder, &policy.policy_id).unwrap();
    assert!(updated.beneficiary.is_none());

    // Payout must now go to holder, not the former beneficiary.
    inject_approved_claim(
        &env,
        &contract_id,
        1,
        &updated,
        &holder,
        &token_addr,
        4_000_000,
    );

    let tok = token::Client::new(&env, &token_addr);
    let before_holder = tok.balance(&holder);
    let before_ben = tok.balance(&beneficiary);
    client.process_claim(&1u64);
    assert_eq!(tok.balance(&holder), before_holder + 4_000_000i128);
    assert_eq!(tok.balance(&beneficiary), before_ben, "former beneficiary must not receive payout after clear");
}
