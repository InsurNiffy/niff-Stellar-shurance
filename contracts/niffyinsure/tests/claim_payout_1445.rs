//! Issue #1445 — Claim payout: acceptance tests.
//!
//! Covers: override asset payout, beneficiary recipient, double-pay rejection,
//! installment totals equal net, and payout-timeout transition.

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{
        AgeBand, ClaimStatus, CoverageTier, InitiatePolicyOptions, PolicyType, PolicyTypeConfig,
        RegionTier, VoteOption,
    },
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String, Vec,
};

const INITIAL_LEDGER: u32 = 500;
const BALANCE: i128 = 100_000_000_000;

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = INITIAL_LEDGER);
    let id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

fn mint_and_approve(env: &Env, token: &Address, client: &NiffyInsureClient<'_>, who: &Address) {
    token::StellarAssetClient::new(env, token).mint(who, &BALANCE);
    token::Client::new(env, token).approve(
        who,
        &client.address,
        &BALANCE,
        &(env.ledger().sequence() + 50_000),
    );
}

fn fund_contract(env: &Env, token: &Address, contract: &Address) {
    token::StellarAssetClient::new(env, token).mint(contract, &BALANCE);
}

fn seed_voter(client: &NiffyInsureClient<'_>, addr: &Address) {
    client.test_seed_policy(addr, &99u32, &1_000_000i128, &100_000u32);
}

fn policy_opts(env: &Env, beneficiary: Option<Address>, deductible: Option<i128>) -> InitiatePolicyOptions {
    InitiatePolicyOptions {
        beneficiary,
        deductible,
        ..InitiatePolicyOptions::test_defaults(env)
    }
}

fn create_policy_and_file_claim(
    env: &Env,
    client: &NiffyInsureClient<'_>,
    token: &Address,
    holder: &Address,
    beneficiary: Option<Address>,
    deductible: Option<i128>,
    claim_amount: i128,
) -> u64 {
    mint_and_approve(env, token, client, holder);
    client.initiate_policy(
        holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &(claim_amount * 2),
        token,
        &policy_opts(env, beneficiary, deductible),
    );
    let details = String::from_str(env, "storm damage");
    let ev: Vec<niffyinsure::types::ClaimEvidenceEntry> = Vec::new(env);
    client.file_claim(holder, &1u32, &claim_amount, &details, &ev, &None)
}

fn approve_claim(client: &NiffyInsureClient<'_>, voter: &Address, claim_id: u64) {
    client.vote_on_claim(voter, &claim_id, &VoteOption::Approve);
}

fn advance_past_dispute(env: &Env, client: &NiffyInsureClient<'_>, claim_id: u64) {
    let claim = client.get_claim(&claim_id);
    env.ledger()
        .with_mut(|l| l.sequence_number = claim.dispute_deadline_ledger + 1);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

/// Payout uses the PolicyTypeConfig override asset when set, not the policy's
/// premium asset.
#[test]
fn payout_uses_policy_type_override_asset() {
    let (env, client, admin, token) = setup();

    let issuer2 = Address::generate(&env);
    let override_token = env.register_stellar_asset_contract_v2(issuer2).address();

    client.set_allowed_asset(&admin, &token, &true);
    client.set_allowed_asset(&admin, &override_token, &true);
    client.admin_register_policy_type(
        &admin,
        &PolicyType::Auto,
        &PolicyTypeConfig {
            payout_asset_override: Some(override_token.clone()),
        },
    );
    fund_contract(&env, &override_token, &client.address);

    let holder = Address::generate(&env);
    let voter = Address::generate(&env);
    seed_voter(&client, &voter);

    let claim_id = create_policy_and_file_claim(&env, &client, &token, &holder, None, None, 500_000);
    approve_claim(&client, &voter, claim_id);
    advance_past_dispute(&env, &client, claim_id);

    let bal_before = token::Client::new(&env, &override_token).balance(&holder);
    client.process_claim(&claim_id);
    let bal_after = token::Client::new(&env, &override_token).balance(&holder);

    assert!(bal_after > bal_before, "override asset must be paid to holder");
    assert_eq!(client.get_claim(&claim_id).status, ClaimStatus::Paid);
}

/// When a beneficiary is set on the policy, payout goes to the beneficiary.
#[test]
fn payout_goes_to_beneficiary_when_set() {
    let (env, client, _admin, token) = setup();
    fund_contract(&env, &token, &client.address);

    let holder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let voter = Address::generate(&env);
    seed_voter(&client, &voter);

    let claim_id = create_policy_and_file_claim(
        &env,
        &client,
        &token,
        &holder,
        Some(beneficiary.clone()),
        None,
        400_000,
    );
    approve_claim(&client, &voter, claim_id);
    advance_past_dispute(&env, &client, claim_id);

    let holder_before = token::Client::new(&env, &token).balance(&holder);
    let bene_before = token::Client::new(&env, &token).balance(&beneficiary);

    client.process_claim(&claim_id);

    let holder_after = token::Client::new(&env, &token).balance(&holder);
    let bene_after = token::Client::new(&env, &token).balance(&beneficiary);

    assert_eq!(holder_after, holder_before, "holder balance must not change");
    assert!(bene_after > bene_before, "beneficiary must receive payout");
}

/// Calling `process_claim` a second time on a `Paid` claim returns `AlreadyPaid`.
#[test]
fn double_pay_is_rejected() {
    let (env, client, _admin, token) = setup();
    fund_contract(&env, &token, &client.address);

    let holder = Address::generate(&env);
    let voter = Address::generate(&env);
    seed_voter(&client, &voter);

    let claim_id = create_policy_and_file_claim(&env, &client, &token, &holder, None, None, 200_000);
    approve_claim(&client, &voter, claim_id);
    advance_past_dispute(&env, &client, claim_id);

    client.process_claim(&claim_id);

    let result = client.try_process_claim(&claim_id);
    assert!(result.is_err(), "second process_claim must fail with AlreadyPaid");
}

/// Sum of installments equals `amount - deductible`; `Paid` only after the last.
#[test]
fn installment_totals_equal_net_and_paid_on_last() {
    let (env, client, _admin, token) = setup();
    fund_contract(&env, &token, &client.address);

    let holder = Address::generate(&env);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    seed_voter(&client, &voter1);
    seed_voter(&client, &voter2);

    let gross: i128 = 900_000;
    let deductible: i128 = 100_000;
    let net = gross - deductible;

    let claim_id = create_policy_and_file_claim(
        &env,
        &client,
        &token,
        &holder,
        None,
        Some(deductible),
        gross,
    );
    approve_claim(&client, &voter1, claim_id);
    approve_claim(&client, &voter2, claim_id);
    advance_past_dispute(&env, &client, claim_id);

    let installment = net / 3;

    client.disburse_installment(&claim_id, &installment);
    assert_eq!(client.get_claim(&claim_id).status, ClaimStatus::Approved);

    client.disburse_installment(&claim_id, &installment);
    assert_eq!(client.get_claim(&claim_id).status, ClaimStatus::Approved);

    let remainder = net - 2 * installment;
    client.disburse_installment(&claim_id, &remainder);

    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.status, ClaimStatus::Paid);
    assert_eq!(claim.paid_amount, net);
}

/// An approved claim not processed before the payout deadline transitions to
/// `PayoutTimeout` via `process_payout_timeout`.
#[test]
fn payout_timeout_transitions_approved_to_payout_timeout() {
    let (env, client, _admin, token) = setup();
    fund_contract(&env, &token, &client.address);

    let holder = Address::generate(&env);
    let voter = Address::generate(&env);
    seed_voter(&client, &voter);

    let claim_id = create_policy_and_file_claim(&env, &client, &token, &holder, None, None, 300_000);
    approve_claim(&client, &voter, claim_id);

    let claim = client.get_claim(&claim_id);
    env.ledger()
        .with_mut(|l| l.sequence_number = claim.payout_deadline_ledger + 1);

    client.process_payout_timeout(&claim_id);

    assert_eq!(client.get_claim(&claim_id).status, ClaimStatus::PayoutTimeout);
}

/// `process_payout_timeout` must fail if the deadline has not yet passed.
#[test]
fn payout_timeout_before_deadline_is_rejected() {
    let (env, client, _admin, token) = setup();
    fund_contract(&env, &token, &client.address);

    let holder = Address::generate(&env);
    let voter = Address::generate(&env);
    seed_voter(&client, &voter);

    let claim_id = create_policy_and_file_claim(&env, &client, &token, &holder, None, None, 300_000);
    approve_claim(&client, &voter, claim_id);

    let result = client.try_process_payout_timeout(&claim_id);
    assert!(result.is_err(), "must reject before deadline passes");
}
