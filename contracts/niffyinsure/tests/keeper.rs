//! Permissionless keeper entrypoints: `process_expired`, `process_deadline`.

#![cfg(test)]

use niffyinsure::{
    types::{ClaimStatus, VoteOption, DEFAULT_GRACE_PERIOD_LEDGERS},
    validate::Error,
    NiffyInsureClient, PolicyError,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env, String,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

fn seed(client: &NiffyInsureClient, holder: &Address, coverage: i128, end_ledger: u32) {
    client.test_seed_policy(holder, &1u32, &coverage, &end_ledger);
}

// ── process_expired ───────────────────────────────────────────────────────────

#[test]
fn process_expired_succeeds_after_grace_end() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let end = 1_000u32;
    seed(&client, &holder, 500_000, end);

    let lapse = end.saturating_add(DEFAULT_GRACE_PERIOD_LEDGERS);
    env.ledger().with_mut(|l| l.sequence_number = lapse);

    client.process_expired(&holder, &1u32);

    let p = client.get_policy(&holder, &1u32).expect("policy");
    assert!(!p.is_active);
}

#[test]
fn process_expired_idempotent_when_already_inactive() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let end = 1_000u32;
    seed(&client, &holder, 500_000, end);
    let lapse = end.saturating_add(DEFAULT_GRACE_PERIOD_LEDGERS);
    env.ledger().with_mut(|l| l.sequence_number = lapse);

    client.process_expired(&holder, &1u32);
    client.process_expired(&holder, &1u32);
    assert!(!client.get_policy(&holder, &1u32).unwrap().is_active);
}

#[test]
fn process_expired_reverts_before_lapse() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let end = 10_000u32;
    seed(&client, &holder, 500_000, end);

    let too_early = end.saturating_add(DEFAULT_GRACE_PERIOD_LEDGERS).saturating_sub(1);
    env.ledger().with_mut(|l| l.sequence_number = too_early);

    let err = client
        .try_process_expired(&holder, &1u32)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, PolicyError::PolicyLapseNotReached);
}

#[test]
fn process_expired_reverts_when_open_claim() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let h2 = Address::generate(&env);
    let end = 500u32;
    seed(&client, &holder, 1_000_000, end);
    seed(&client, &h2, 1_000_000, 50_000);
    client.admin_set_quorum_bps(&10_000u32);

    let details = String::from_str(&env, "open");
    let urls = vec![&env];
    let _cid = client.file_claim(&holder, &1u32, &50_000i128, &details, &urls, &None);

    let lapse = end.saturating_add(DEFAULT_GRACE_PERIOD_LEDGERS);
    env.ledger().with_mut(|l| l.sequence_number = lapse);

    let err = client
        .try_process_expired(&holder, &1u32)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, PolicyError::OpenClaimsMustFinalize);
}

// ── process_deadline ──────────────────────────────────────────────────────────

#[test]
fn process_deadline_finalizes_like_finalize_claim() {
    let (env, client, _, _) = setup();
    let h1 = Address::generate(&env);
    let h2 = Address::generate(&env);
    seed(&client, &h1, 1_000_000, 50_000);
    seed(&client, &h2, 1_000_000, 50_000);
    client.admin_set_quorum_bps(&10_000u32);

    let details = String::from_str(&env, "x");
    let urls = vec![&env];
    let cid = client.file_claim(&h1, &1u32, &100_000i128, &details, &urls, &None);

    let deadline = client.get_claim(&cid).voting_deadline_ledger;
    env.ledger().with_mut(|l| l.sequence_number = deadline.saturating_add(1));

    let st = client.process_deadline(&cid);
    assert_ne!(st, ClaimStatus::Processing);
}

#[test]
fn process_deadline_reverts_while_voting_open() {
    let (env, client, _, _) = setup();
    let h1 = Address::generate(&env);
    let h2 = Address::generate(&env);
    seed(&client, &h1, 1_000_000, 50_000);
    seed(&client, &h2, 1_000_000, 50_000);
    client.admin_set_quorum_bps(&10_000u32);

    let details = String::from_str(&env, "x");
    let urls = vec![&env];
    let cid = client.file_claim(&h1, &1u32, &100_000i128, &details, &urls, &None);

    let deadline = client.get_claim(&cid).voting_deadline_ledger;
    env.ledger().with_mut(|l| l.sequence_number = deadline);

    let err = client.try_process_deadline(&cid).err().unwrap().unwrap();
    assert_eq!(err, Error::VotingWindowStillOpen);
}

#[test]
fn process_deadline_reverts_when_already_terminal() {
    let (env, client, _, _) = setup();
    let h1 = Address::generate(&env);
    let h2 = Address::generate(&env);
    seed(&client, &h1, 1_000_000, 50_000);
    seed(&client, &h2, 1_000_000, 50_000);
    client.admin_set_quorum_bps(&10_000u32);

    let details = String::from_str(&env, "x");
    let urls = vec![&env];
    let cid = client.file_claim(&h1, &1u32, &100_000i128, &details, &urls, &None);

    client.vote_on_claim(&h1, &cid, &VoteOption::Approve);
    client.vote_on_claim(&h2, &cid, &VoteOption::Approve);

    let err = client.try_process_deadline(&cid).err().unwrap().unwrap();
    assert_eq!(err, Error::ClaimAlreadyTerminal);
}

#[test]
fn process_deadline_returns_calculator_paused_when_claims_paused() {
    let (env, client, admin, _) = setup();
    let h1 = Address::generate(&env);
    let h2 = Address::generate(&env);
    seed(&client, &h1, 1_000_000, 50_000);
    seed(&client, &h2, 1_000_000, 50_000);
    client.admin_set_quorum_bps(&10_000u32);

    let details = String::from_str(&env, "x");
    let urls = vec![&env];
    let cid = client.file_claim(&h1, &1u32, &100_000i128, &details, &urls, &None);

    let deadline = client.get_claim(&cid).voting_deadline_ledger;
    env.ledger().with_mut(|l| l.sequence_number = deadline.saturating_add(1));

    client.pause_claims(&admin, &0u32);
    let err = client.try_process_deadline(&cid).err().unwrap().unwrap();
    assert_eq!(err, Error::CalculatorPaused);
}
