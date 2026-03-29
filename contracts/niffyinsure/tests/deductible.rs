//! Deductible: bind-time validation, payout net = gross − deductible, events.

use niffyinsure::{
    types::{
        AgeBand, ClaimStatus, CoverageTier, PolicyType, RegionTier, VoteOption,
    },
    validate::Error as ValidateError,
    NiffyInsureClient, PolicyError,
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

fn seed_voter(client: &NiffyInsureClient<'_>, holder: &Address) {
    client.test_seed_policy(holder, &1u32, &1_000_000i128, &10_000u32);
}

fn approve_claim_flow(
    env: &Env,
    client: &NiffyInsureClient<'_>,
    token: &Address,
    deductible: Option<i128>,
    claim_gross: i128,
) -> (Address, u64) {
    mint(env, token, &client.address, 500_000_000i128);

    let holder = Address::generate(env);
    let voter1 = Address::generate(env);
    let voter2 = Address::generate(env);
    fund_holder(env, client, token, &holder);
    seed_voter(client, &voter1);
    seed_voter(client, &voter2);

    let _policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        token,
        &None::<Address>,
        &deductible,
    );

    let details = String::from_str(env, "deductible test");
    let urls = vec![env];
    let claim_id = client.file_claim(&holder, &1u32, &claim_gross, &details, &urls);

    let c = client.get_claim(&claim_id);
    assert_eq!(c.deductible, deductible.unwrap_or(0));

    client.vote_on_claim(&voter1, &claim_id, &VoteOption::Approve);
    client.vote_on_claim(&voter2, &claim_id, &VoteOption::Approve);
    let c = client.get_claim(&claim_id);
    assert_eq!(c.status, ClaimStatus::Approved);

    (holder, claim_id)
}

#[test]
fn payout_with_zero_deductible_pays_full_gross() {
    let (env, client, _admin, token) = setup();
    let (holder, claim_id) = approve_claim_flow(&env, &client, &token, None, 80_000);
    let token_client = token::Client::new(&env, &token);
    let before = token_client.balance(&holder);
    client.process_claim(&claim_id);
    assert_eq!(token_client.balance(&holder), before + 80_000);
}

#[test]
fn payout_with_partial_deductible_pays_net() {
    let (env, client, _admin, token) = setup();
    let (holder, claim_id) = approve_claim_flow(&env, &client, &token, Some(25_000), 80_000);
    let token_client = token::Client::new(&env, &token);
    let before = token_client.balance(&holder);
    client.process_claim(&claim_id);
    assert_eq!(token_client.balance(&holder), before + 55_000);
}

#[test]
fn process_claim_fails_when_deductible_gte_gross() {
    let (env, client, _admin, token) = setup();
    let (_holder, claim_id) = approve_claim_flow(&env, &client, &token, Some(60_000), 50_000);
    let r = client.try_process_claim(&claim_id);
    assert_eq!(
        r.unwrap_err().unwrap(),
        ValidateError::ClaimAmountZero,
        "net payout ≤ 0 must not transfer (ClaimAmountZero — no free contracterror slot)"
    );
}

#[test]
fn initiate_rejects_deductible_above_coverage() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    let r = client.try_initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &100_000,
        &token,
        &None::<Address>,
        &Some(100_001i128),
    );
    assert!(matches!(
        r,
        Err(Ok(PolicyError::InvalidDeductible))
    ));
}
