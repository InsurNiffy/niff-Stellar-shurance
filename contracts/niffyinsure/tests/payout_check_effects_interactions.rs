//! Check-effects-interactions: a failed payout transfer must not leave a
//! claim marked `Paid`. `process_claim` sets `claim.status = Paid` and
//! persists it BEFORE invoking the token transfer ("interaction"). If the
//! transfer fails, the whole host invocation reverts (Soroban has no partial
//! commits within a single top-level call), so the earlier `Paid` write is
//! rolled back along with everything else — the claim is left `Approved`.

#![cfg(test)]

use niffyinsure::{
    types::{AgeBand, ClaimStatus, CoverageTier, PolicyType, RegionTier, VoteOption},
    validate::Error as ValidateError,
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

fn seed_voter(client: &NiffyInsureClient<'_>, holder: &Address) {
    client.test_seed_policy(holder, &1u32, &1_000_000i128, &10_000u32);
}

/// Approve a claim but deliberately leave the contract treasury empty and
/// reinsurance unconfigured, so the transfer step inside `payout()` fails
/// cleanly with `NoReinsuranceConfigured` instead of paying out.
fn approve_claim_with_empty_treasury(
    env: &Env,
    client: &NiffyInsureClient<'_>,
    token: &Address,
) -> u64 {
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
        &niffyinsure::types::InitiatePolicyOptions::test_defaults(env),
    );

    let details = String::from_str(env, "check-effects-interactions test");
    let urls = vec![env];
    let claim_id = client.file_claim(&holder, &1u32, &80_000i128, &details, &urls, &None);

    client.vote_on_claim(&voter1, &claim_id, &VoteOption::Approve);
    client.vote_on_claim(&voter2, &claim_id, &VoteOption::Approve);

    let c = client.get_claim(&claim_id);
    assert_eq!(c.status, ClaimStatus::Approved);
    claim_id
}

#[test]
fn failed_transfer_does_not_leave_claim_paid() {
    let (env, client, _admin, token) = setup();
    // No `mint` to the contract address and no reinsurance contract
    // configured — the transfer step in `payout()` cannot succeed.
    let claim_id = approve_claim_with_empty_treasury(&env, &client, &token);

    let r = client.try_process_claim(&claim_id);
    assert_eq!(
        r.unwrap_err().unwrap(),
        ValidateError::NoReinsuranceConfigured,
        "empty treasury with no reinsurance must fail the transfer step"
    );

    // The critical assertion: status must have reverted to Approved, not
    // be stuck at Paid. This proves the `Paid` write made before the
    // transfer was rolled back atomically with the rest of the invocation.
    let c = client.get_claim(&claim_id);
    assert_eq!(
        c.status,
        ClaimStatus::Approved,
        "a failed payout transfer must never leave the claim in Paid state"
    );
}

#[test]
fn successful_transfer_leaves_claim_paid_exactly_once() {
    let (env, client, _admin, token) = setup();
    mint(&env, &token, &client.address, 500_000_000i128);
    let claim_id = approve_claim_with_empty_treasury_but_funded(&env, &client, &token);

    client.process_claim(&claim_id);
    let c = client.get_claim(&claim_id);
    assert_eq!(c.status, ClaimStatus::Paid);

    // A second attempt must fail with AlreadyPaid, never double-pay.
    let r = client.try_process_claim(&claim_id);
    assert_eq!(r.unwrap_err().unwrap(), ValidateError::AlreadyPaid);
}

fn approve_claim_with_empty_treasury_but_funded(
    env: &Env,
    client: &NiffyInsureClient<'_>,
    token: &Address,
) -> u64 {
    approve_claim_with_empty_treasury(env, client, token)
}
