//! Claim filing fee: zero fee no-op, non-zero fee deducted at file_claim,
//! and full refund on withdraw_claim before any vote.

#![cfg(test)]

use niffyinsure::{
    types::{AgeBand, CoverageTier, PolicyType, RegionTier},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, vec, Address, Env, String,
};

const INITIAL_LEDGER: u32 = 400;
const STARTING_BALANCE: i128 = 10_000_000_000;

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.sequence_number = INITIAL_LEDGER;
    });
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    token::StellarAssetClient::new(env, token).mint(to, &amount);
}

fn fund_holder(env: &Env, client: &NiffyInsureClient<'_>, token: &Address, holder: &Address) {
    mint(env, token, holder, STARTING_BALANCE);
    token::Client::new(env, token).approve(
        holder,
        &client.address,
        &STARTING_BALANCE,
        &(env.ledger().sequence() + 10_000),
    );
}

fn bind_policy(env: &Env, client: &NiffyInsureClient<'_>, token: &Address, holder: &Address) {
    let _ = client.initiate_policy(
        holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        token,
        &niffyinsure::types::InitiatePolicyOptions::test_defaults(env),
    );
}

#[test]
fn zero_filing_fee_does_not_affect_normal_flow() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);
    bind_policy(&env, &client, &token, &holder);

    let balance_before = token::Client::new(&env, &token).balance(&holder);

    let details = String::from_str(&env, "zero fee claim");
    let urls = vec![&env];
    let claim_id = client.file_claim(&holder, &1u32, &50_000i128, &details, &urls, &None);

    let balance_after = token::Client::new(&env, &token).balance(&holder);
    // No filing fee configured (default 0) — only the premium was already
    // spent at bind time; filing itself must not move any additional funds.
    assert_eq!(balance_before, balance_after);

    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.amount, 50_000i128);
}

#[test]
fn non_zero_filing_fee_deducted_atomically_at_file_claim() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);
    bind_policy(&env, &client, &token, &holder);

    let fee: i128 = 25_000;
    client.admin_set_claim_filing_fee(&fee);
    assert_eq!(client.get_claim_filing_fee(), fee);

    let token_client = token::Client::new(&env, &token);
    let balance_before = token_client.balance(&holder);

    let details = String::from_str(&env, "fee claim");
    let urls = vec![&env];
    let _claim_id = client.file_claim(&holder, &1u32, &50_000i128, &details, &urls, &None);

    let balance_after = token_client.balance(&holder);
    assert_eq!(balance_before - balance_after, fee);
}

#[test]
fn withdraw_before_voting_refunds_filing_fee_in_full() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);
    bind_policy(&env, &client, &token, &holder);

    let fee: i128 = 25_000;
    client.admin_set_claim_filing_fee(&fee);

    let token_client = token::Client::new(&env, &token);
    let balance_before_filing = token_client.balance(&holder);

    let details = String::from_str(&env, "withdraw refund test");
    let urls = vec![&env];
    let claim_id = client.file_claim(&holder, &1u32, &50_000i128, &details, &urls, &None);

    let balance_after_filing = token_client.balance(&holder);
    assert_eq!(balance_before_filing - balance_after_filing, fee);

    client.withdraw_claim(&holder, &claim_id);

    let balance_after_withdraw = token_client.balance(&holder);
    // Fee refunded in full — holder's balance is back to pre-filing level.
    assert_eq!(balance_after_withdraw, balance_before_filing);
}
