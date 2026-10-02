//! Protocol fee configuration and premium split tests.

#![cfg(test)]

use niffyinsure::{
    types::{
        AgeBand, CoverageTier, InitiatePolicyOptions, PolicyType, PROTOCOL_FEE_BPS_MAX, RegionTier,
    },
    validate::Error as ValidateError,
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

fn fund_holder(env: &Env, client: &NiffyInsureClient<'_>, token: &Address, holder: &Address) {
    let amount = 100_000_000i128;
    token::StellarAssetClient::new(env, token).mint(holder, &amount);
    token::Client::new(env, token).approve(
        holder,
        &client.address,
        &amount,
        &(env.ledger().sequence() + 10_000),
    );
}

fn initiate_policy(
    env: &Env,
    client: &NiffyInsureClient,
    holder: &Address,
    token: &Address,
) -> niffyinsure::types::Policy {
    client.initiate_policy(
        holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        token,
        &InitiatePolicyOptions::test_defaults(env),
    )
}

fn quote_premium(client: &NiffyInsureClient, token: &Address) -> i128 {
    client
        .generate_premium_for_asset(
            &niffyinsure::types::RiskInput {
                region: RegionTier::Medium,
                age_band: AgeBand::Adult,
                coverage: CoverageTier::Standard,
                safety_score: 80,
            },
            &1_000_000,
            &false,
            token,
        )
        .total_premium
}

#[test]
fn zero_fee_sends_full_premium_to_treasury() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    let recipient = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    client.admin_set_fee_recipient(&recipient);
    client.admin_set_protocol_fee_bps(&0u32);

    let premium = quote_premium(&client, &token);
    initiate_policy(&env, &client, &holder, &token);

    assert_eq!(client.get_protocol_fee_bps(), 0);
    assert_eq!(client.get_fee_recipient(), recipient);
    assert_eq!(client.get_treasury_balance(), premium);
    assert_eq!(
        token::StellarAssetClient::new(&env, &token).balance(&recipient),
        0
    );
}

#[test]
fn non_zero_fee_splits_premium_between_treasury_and_recipient() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    let recipient = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    client.admin_set_fee_recipient(&recipient);
    client.admin_set_protocol_fee_bps(&250u32);

    let premium = quote_premium(&client, &token);
    let fee = premium * 250 / 10_000;

    initiate_policy(&env, &client, &holder, &token);

    assert_eq!(
        token::StellarAssetClient::new(&env, &token).balance(&recipient),
        fee
    );
    assert_eq!(client.get_treasury_balance(), premium - fee);
}

#[test]
fn max_fee_is_allowed_and_calculated_correctly() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    let recipient = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    client.admin_set_fee_recipient(&recipient);
    client.admin_set_protocol_fee_bps(&PROTOCOL_FEE_BPS_MAX);

    let premium = quote_premium(&client, &token);
    let fee = premium * (PROTOCOL_FEE_BPS_MAX as i128) / 10_000;

    initiate_policy(&env, &client, &holder, &token);

    assert_eq!(
        token::StellarAssetClient::new(&env, &token).balance(&recipient),
        fee
    );
    assert_eq!(client.get_treasury_balance(), premium - fee);
}

#[test]
fn fee_recipient_update_is_used_for_subsequent_premiums() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    let first_recipient = Address::generate(&env);
    let second_recipient = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    client.admin_set_fee_recipient(&first_recipient);
    client.admin_set_fee_recipient(&second_recipient);
    client.admin_set_protocol_fee_bps(&500u32);

    let premium = quote_premium(&client, &token);
    let fee = premium * 500 / 10_000;

    initiate_policy(&env, &client, &holder, &token);

    assert_eq!(client.get_fee_recipient(), second_recipient);
    assert_eq!(
        token::StellarAssetClient::new(&env, &token).balance(&first_recipient),
        0
    );
    assert_eq!(
        token::StellarAssetClient::new(&env, &token).balance(&second_recipient),
        fee
    );
}

#[test]
fn protocol_fee_above_max_reverts() {
    let (_env, client, _, _) = setup();
    let err = client
        .try_admin_set_protocol_fee_bps(&(PROTOCOL_FEE_BPS_MAX + 1))
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, ValidateError::ProtocolFeeOutOfBounds.into());
}
