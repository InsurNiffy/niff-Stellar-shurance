#![cfg(test)]

//! Integration tests for on-chain `Claim.status_history` and `get_claim_history`.

use niffyinsure::{
    types::{
        AgeBand, ClaimStatus, CoverageTier, PolicyType, RegionTier, VoteOption,
        VOTE_WINDOW_LEDGERS,
    },
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, vec, Address, Env, String,
};

const INITIAL_LEDGER: u32 = 300;
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

#[test]
fn status_history_order_matches_transitions_and_get_claim_history() {
    let (env, client, _admin, token) = setup();
    mint(&env, &token, &client.address, 200_000_000i128);

    let holder = Address::generate(&env);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);
    seed_voter(&client, &voter1);
    seed_voter(&client, &voter2);

    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &None::<soroban_sdk::Address>,
        &None,
    );

    let details = String::from_str(&env, "timeline test");
    let urls = vec![&env];
    let claim_id = client.file_claim(&holder, &policy.policy_id, &50_000, &details, &urls);

    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.status_history.len(), 1u32);
    assert_eq!(
        claim.status_history.get(0).unwrap().status,
        ClaimStatus::Processing
    );
    assert_eq!(
        claim.status_history.get(0).unwrap().ledger,
        INITIAL_LEDGER
    );

    client.vote_on_claim(&voter1, &claim_id, &VoteOption::Approve);
    client.vote_on_claim(&voter2, &claim_id, &VoteOption::Approve);

    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.status, ClaimStatus::Approved);
    assert_eq!(claim.status_history.len(), 2u32);
    assert_eq!(
        claim.status_history.get(0).unwrap().status,
        ClaimStatus::Processing
    );
    assert_eq!(
        claim.status_history.get(1).unwrap().status,
        ClaimStatus::Approved
    );

    client.process_claim(&claim_id);

    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.status, ClaimStatus::Paid);
    assert_eq!(claim.status_history.len(), 3u32);
    assert_eq!(
        claim.status_history.get(2).unwrap().status,
        ClaimStatus::Paid
    );

    let hist = client.get_claim_history(&claim_id);
    assert_eq!(hist.len(), claim.status_history.len());
    for i in 0..hist.len() {
        assert_eq!(
            hist.get(i).unwrap().status,
            claim.status_history.get(i).unwrap().status
        );
        assert_eq!(
            hist.get(i).unwrap().ledger,
            claim.status_history.get(i).unwrap().ledger
        );
    }
}

#[test]
fn status_history_finalize_reject_sequence() {
    let (env, client, _admin, token) = setup();
    mint(&env, &token, &client.address, 200_000_000i128);

    let holder = Address::generate(&env);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);
    seed_voter(&client, &voter1);
    seed_voter(&client, &voter2);

    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &None::<soroban_sdk::Address>,
        &None,
    );

    let details = String::from_str(&env, "reject path");
    let urls = vec![&env];
    let claim_id = client.file_claim(&holder, &policy.policy_id, &50_000, &details, &urls);

    // Split vote — no majority until deadline
    client.vote_on_claim(&voter1, &claim_id, &VoteOption::Approve);
    client.vote_on_claim(&voter2, &claim_id, &VoteOption::Reject);

    env.ledger().with_mut(|l| {
        l.sequence_number = INITIAL_LEDGER + VOTE_WINDOW_LEDGERS + 1;
    });

    client.finalize_claim(&claim_id);

    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.status, ClaimStatus::Rejected);
    assert_eq!(claim.status_history.len(), 2u32);
    assert_eq!(
        claim.status_history.get(0).unwrap().status,
        ClaimStatus::Processing
    );
    assert_eq!(
        claim.status_history.get(1).unwrap().status,
        ClaimStatus::Rejected
    );
}
