//! file_claim validation guards (Issue #1439).

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{PauseReason, DETAILS_MAX_LEN},
    validate::Error,
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String, Vec,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 1_000);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

fn seed_active(client: &NiffyInsureClient, holder: &Address) {
    client.test_seed_policy(holder, &1u32, &1_000_000i128, &200_000u32);
}

fn try_file(
    env: &Env,
    client: &NiffyInsureClient,
    holder: &Address,
    amount: i128,
    details: &str,
    evidence: &soroban_sdk::Vec<niffyinsure::types::ClaimEvidenceEntry>,
) -> Result<u64, Error> {
    match client.try_file_claim(
        holder,
        &1u32,
        &amount,
        &String::from_str(env, details),
        evidence,
        &None,
    ) {
        Ok(Ok(id)) => Ok(id),
        Err(Ok(e)) => Err(e),
        Ok(Err(_)) => panic!("unexpected conversion error on file_claim"),
        Err(Err(_)) => panic!("unexpected invoke error on file_claim"),
    }
}

#[test]
fn happy_path_files_claim() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder);
    let ev = common::empty_evidence(&env);
    let cid = try_file(&env, &client, &holder, 50_000, "ok", &ev).unwrap();
    let claim = client.get_claim(&cid);
    assert_eq!(claim.amount, 50_000);
    assert_eq!(claim.policy_id, 1);
}

#[test]
fn rejects_unknown_policy_holder() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let outsider = Address::generate(&env);
    seed_active(&client, &holder);
    let ev = common::empty_evidence(&env);
    let err = try_file(&env, &client, &outsider, 50_000, "x", &ev).unwrap_err();
    assert_eq!(err, Error::PolicyNotFound);
}

#[test]
fn rejects_inactive_policy() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder);
    client.test_set_policy_flag_and_window(&holder, &1u32, &false, &1u32, &200_000u32);
    let ev = common::empty_evidence(&env);
    let err = try_file(&env, &client, &holder, 50_000, "x", &ev).unwrap_err();
    assert_eq!(err, Error::PolicyInactive);
}

#[test]
fn rejects_outside_policy_window() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder);
    // Window starts in the future relative to ledger 1000.
    client.test_set_policy_flag_and_window(&holder, &1u32, &true, &5_000u32, &200_000u32);
    let ev = common::empty_evidence(&env);
    let err = try_file(&env, &client, &holder, 50_000, "x", &ev).unwrap_err();
    assert_eq!(err, Error::PolicyInactive);
}

#[test]
fn rejects_zero_amount() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder);
    let ev = common::empty_evidence(&env);
    let err = try_file(&env, &client, &holder, 0, "x", &ev).unwrap_err();
    assert_eq!(err, Error::ClaimAmountZero);
}

#[test]
fn rejects_amount_above_coverage() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder);
    let ev = common::empty_evidence(&env);
    let err = try_file(&env, &client, &holder, 1_000_001, "x", &ev).unwrap_err();
    assert_eq!(err, Error::ClaimExceedsCoverage);
}

#[test]
fn rejects_asset_claim_bounds() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder);
    client.admin_set_asset_claim_bounds(&token, &100_000i128, &500_000i128);
    let ev = common::empty_evidence(&env);
    let err = try_file(&env, &client, &holder, 50_000, "x", &ev).unwrap_err();
    assert_eq!(err, Error::ClaimBelowMinAmount);
}

#[test]
fn rejects_when_claims_paused() {
    let (env, client, admin, _) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder);
    client.pause_claims(&admin, &PauseReason::SecurityIncident);
    let ev = common::empty_evidence(&env);
    // Claims pause traps rather than returning a typed Error.
    assert!(client
        .try_file_claim(
            &holder,
            &1u32,
            &50_000i128,
            &String::from_str(&env, "x"),
            &ev,
            &None,
        )
        .is_err());
}

#[test]
fn rejects_details_too_long() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder);
    let long = "a".repeat((DETAILS_MAX_LEN as usize) + 1);
    let ev = common::empty_evidence(&env);
    let err = try_file(&env, &client, &holder, 50_000, &long, &ev).unwrap_err();
    assert_eq!(err, Error::DetailsTooLong);
}

#[test]
fn rejects_insufficient_evidence_count() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder);
    client.admin_set_min_evidence_count(&1u32);
    let ev = common::empty_evidence(&env);
    let err = try_file(&env, &client, &holder, 50_000, "x", &ev).unwrap_err();
    assert_eq!(err, Error::InsufficientEvidence);
}

#[test]
fn rejects_too_many_evidence_entries() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder);
    client.admin_set_max_evidence_count(&1u32);
    let mut ev = common::one_url_evidence(&env, "ipfs://a");
    ev.push_back(niffyinsure::types::ClaimEvidenceEntry {
        url: String::from_str(&env, "ipfs://b"),
        hash: common::non_zero_hash(&env),
    });
    let err = try_file(&env, &client, &holder, 50_000, "x", &ev).unwrap_err();
    assert_eq!(err, Error::TooManyImageUrls);
}

#[test]
fn rejects_bad_evidence_url() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder);
    let ev = common::one_url_evidence(&env, "https://evil.example/img.png");
    let err = try_file(&env, &client, &holder, 50_000, "x", &ev).unwrap_err();
    assert_eq!(err, Error::InvalidEvidenceUrl);
}

#[test]
fn rejects_zero_evidence_hash() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder);
    let ev = common::one_url_evidence_with_hash(&env, "ipfs://a", common::zero_hash(&env));
    let err = try_file(&env, &client, &holder, 50_000, "x", &ev).unwrap_err();
    assert_eq!(err, Error::ExcessiveEvidenceBytes);
}

#[test]
fn rejects_insufficient_filing_fee_allowance() {
    let (env, client, _, _token) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder);
    client.admin_set_claim_filing_fee(&1_000i128);
    // Holder has no token allowance for the fee.
    let ev = common::empty_evidence(&env);
    let err = try_file(&env, &client, &holder, 50_000, "x", &ev).unwrap_err();
    assert_eq!(err, Error::InsufficientAllowanceForFee);
}

#[test]
fn rejects_duplicate_open_claim() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder);
    let ev = common::empty_evidence(&env);
    try_file(&env, &client, &holder, 50_000, "first", &ev).unwrap();
    let err = try_file(&env, &client, &holder, 40_000, "second", &ev).unwrap_err();
    assert_eq!(err, Error::DuplicateOpenClaim);
}

#[test]
fn rejects_cooldown_active() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed_active(&client, &holder);
    client.admin_set_cooldown_ledgers(&500u32);
    client.test_set_last_claim_resolved(&holder, &1u32, &800u32);
    // now=1000, last=800, elapsed=200 < 500
    let ev = common::empty_evidence(&env);
    let err = try_file(&env, &client, &holder, 50_000, "x", &ev).unwrap_err();
    assert_eq!(err, Error::CooldownActive);
}

#[test]
fn snapshot_excludes_claimant_and_respects_cap() {
    let (env, client, _, _) = setup();
    let claimant = Address::generate(&env);
    seed_active(&client, &claimant);

    let mut extras: Vec<Address> = Vec::new(&env);
    for _ in 0..5 {
        let v = Address::generate(&env);
        client.test_add_voter(&v);
        extras.push_back(v);
    }

    client.admin_set_max_voters_per_claim(&3u32);
    let ev = common::empty_evidence(&env);
    let cid = try_file(&env, &client, &claimant, 50_000, "snap", &ev).unwrap();

    let snap = client.test_get_claim_voters(&cid);
    assert!(!snap.iter().any(|a| a == claimant), "claimant must be excluded");
    assert_eq!(snap.len(), 3, "must respect max_voters_per_claim");
    assert_eq!(client.get_claim(&cid).eligible_voter_count, 3);
}
