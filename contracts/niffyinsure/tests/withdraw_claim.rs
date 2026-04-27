//! Claimant withdrawal before any vote is cast.

#![cfg(test)]

use niffyinsure::{
    storage,
    types::{ClaimStatus, VoteOption, RATE_LIMIT_WINDOW_LEDGERS},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    vec, Address, Env, String,
};

fn setup() -> (Env, Address, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, contract_id, client, admin, token)
}

fn seed(client: &NiffyInsureClient, holder: &Address, coverage: i128, end_ledger: u32) {
    client.test_seed_policy(holder, &1u32, &coverage, &end_ledger);
}

#[test]
fn withdraw_before_votes_succeeds() {
    let (env, _, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let details = String::from_str(&env, "filed in error");
    let urls = vec![&env];
    let cid = client.file_claim(&holder, &1u32, &100_000i128, &details, &urls, &None);
    client.withdraw_claim(&holder, &cid);
    let c = client.get_claim(&cid);
    assert_eq!(c.status, ClaimStatus::Withdrawn);
}

#[test]
fn withdraw_after_first_vote_reverts() {
    let (env, _, client, _, _) = setup();
    let h1 = Address::generate(&env);
    let h2 = Address::generate(&env);
    seed(&client, &h1, 1_000_000, 10_000);
    seed(&client, &h2, 1_000_000, 10_000);
    let details = String::from_str(&env, "x");
    let urls = vec![&env];
    let cid = client.file_claim(&h1, &1u32, &100_000i128, &details, &urls, &None);
    client.admin_set_quorum_bps(&10_000u32);
    let _ = client.vote_on_claim(&h1, &cid, &VoteOption::Approve);
    assert!(client.try_withdraw_claim(&h1, &cid).is_err());
}

#[test]
fn withdraw_unauthorized_reverts() {
    let (env, _, client, _, _) = setup();
    let holder = Address::generate(&env);
    let other = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let details = String::from_str(&env, "x");
    let urls = vec![&env];
    let cid = client.file_claim(&holder, &1u32, &100_000i128, &details, &urls, &None);
    assert!(client.try_withdraw_claim(&other, &cid).is_err());
}

#[test]
fn withdraw_requires_claimant_auth() {
    let (env, _, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let details = String::from_str(&env, "x");
    let urls = vec![&env];
    let cid = client.file_claim(&holder, &1u32, &100_000i128, &details, &urls, &None);

    env.mock_auths(&[]);
    assert!(client.try_withdraw_claim(&holder, &cid).is_err());
}

#[test]
fn withdraw_emits_claim_withdrawn_event() {
    let (env, _, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let details = String::from_str(&env, "filed in error");
    let urls = vec![&env];
    let cid = client.file_claim(&holder, &1u32, &100_000i128, &details, &urls, &None);

    client.withdraw_claim(&holder, &cid);

    let all_events = env.events().all();
    let mut found = false;
    for (_, topics, _) in all_events.iter() {
        let topic_debug = soroban_sdk::testutils::arbitrary::std::format!("{:?}", topics);
        if topic_debug.contains("claim_withdrawn") {
            found = true;
        }
    }

    assert!(found, "withdrawal must emit claim_withdrawn");
}

#[test]
fn withdraw_restores_rate_limit_anchor_for_refile() {
    let env = Env::default();
    env.mock_all_auths();
    let start = 200u32.saturating_add(RATE_LIMIT_WINDOW_LEDGERS);
    env.ledger().with_mut(|l| l.sequence_number = start);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);

    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, start.saturating_add(50_000));

    env.as_contract(&contract_id, || {
        storage::set_last_claim_ledger(&env, &holder, 200);
    });

    let details = String::from_str(&env, "first");
    let urls = vec![&env];
    let cid1 = client.file_claim(&holder, &1u32, &50_000i128, &details, &urls, &None);
    assert_eq!(cid1, 1u64);

    client.withdraw_claim(&holder, &cid1);

    let details2 = String::from_str(&env, "refile");
    let cid2 = client.file_claim(&holder, &1u32, &60_000i128, &details2, &urls, &None);
    assert_eq!(cid2, 2u64);
}

#[test]
fn withdrawn_claim_cannot_be_finalized_or_paid() {
    let (env, _, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let details = String::from_str(&env, "x");
    let urls = vec![&env];
    let cid = client.file_claim(&holder, &1u32, &100_000i128, &details, &urls, &None);
    client.withdraw_claim(&holder, &cid);

    env.ledger()
        .with_mut(|l| l.sequence_number += RATE_LIMIT_WINDOW_LEDGERS + 10);
    assert!(client.try_finalize_claim(&cid).is_err());
    assert!(client.try_process_claim(&cid).is_err());
}
