//! Participation quorum (`quorum_bps`): snapshot at filing, finalization boundaries, admin ACL.

#![cfg(test)]

use niffyinsure::{
    types::{ClaimStatus, VoteOption, DEFAULT_QUORUM_BPS, QUORUM_BPS_DENOMINATOR, VOTE_WINDOW_LEDGERS},
    NiffyInsureClient,
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

fn file(client: &NiffyInsureClient, holder: &Address, amount: i128, env: &Env) -> u64 {
    let details = String::from_str(env, "quorum test");
    let urls = vec![env];
    client.file_claim(holder, &1u32, &amount, &details, &urls, &None)
}

/// R = ceil(E * Q / DENOM) — must match `claim::required_cast_for_quorum`.
fn required_cast(eligible: u32, quorum_bps: u32) -> u32 {
    if eligible == 0 {
        return 0;
    }
    let n = (eligible as u64) * (quorum_bps as u64);
    n.div_ceil(QUORUM_BPS_DENOMINATOR as u64) as u32
}

#[test]
fn quorum_formula_three_eligible_at_three_thousand_bps() {
    let e = 10u32;
    let q = 3000u32;
    assert_eq!(required_cast(e, q), 3, "ceil(10 * 3000 / 10000) = 3");
}

/// Three voters in snapshot; 100% quorum ⇒ R = 3 ballots required.
#[test]
fn finalize_exactly_at_quorum_participation_plurality_approves() {
    let (env, client, _, _) = setup();
    client.admin_set_quorum_bps(&10_000u32);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);
    let cid = file(&client, &v1, 100_000, &env);
    assert_eq!(client.get_claim_quorum_bps(&cid), 10_000u32);

    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    client.vote_on_claim(&v2, &cid, &VoteOption::Approve);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Processing);

    client.vote_on_claim(&v3, &cid, &VoteOption::Reject);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Approved);
}

#[test]
fn finalize_one_vote_below_quorum_rejects_at_deadline() {
    let (env, client, _, _) = setup();
    client.admin_set_quorum_bps(&10_000u32);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);
    let cid = file(&client, &v1, 100_000, &env);

    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    client.vote_on_claim(&v2, &cid, &VoteOption::Approve);
    env.ledger()
        .with_mut(|l| l.sequence_number += VOTE_WINDOW_LEDGERS + 1);
    client.finalize_claim(&cid);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);
}

#[test]
fn auto_finalize_when_cast_meets_full_quorum() {
    let (env, client, _, _) = setup();
    client.admin_set_quorum_bps(&10_000u32);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);
    let cid = file(&client, &v1, 100_000, &env);

    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    client.vote_on_claim(&v2, &cid, &VoteOption::Approve);
    client.vote_on_claim(&v3, &cid, &VoteOption::Reject);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Approved);

    assert!(client.try_finalize_claim(&cid).is_err());
}

#[test]
fn admin_quorum_change_does_not_retarget_processing_claim() {
    let (env, client, _, _) = setup();
    client.admin_set_quorum_bps(&10_000u32);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);
    let cid = file(&client, &v1, 100_000, &env);
    assert_eq!(client.get_claim_quorum_bps(&cid), 10_000u32);

    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    // Lower live quorum for *future* claims; this claim still needs 3 ballots (snapshot 10_000).
    client.admin_set_quorum_bps(&1u32);
    assert_eq!(client.get_quorum_bps(), 1u32);
    assert_eq!(client.get_claim_quorum_bps(&cid), 10_000u32);

    client.vote_on_claim(&v2, &cid, &VoteOption::Approve);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Processing);

    client.vote_on_claim(&v3, &cid, &VoteOption::Approve);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Approved);
}

#[test]
fn admin_set_quorum_bps_out_of_range_fails() {
    let (_env, client, _, _) = setup();
    assert!(client.try_admin_set_quorum_bps(&0u32).is_err());
    assert!(client.try_admin_set_quorum_bps(&10_001u32).is_err());
}

#[test]
fn default_instance_quorum_matches_constant() {
    let (_env, client, _, _) = setup();
    assert_eq!(client.get_quorum_bps(), DEFAULT_QUORUM_BPS);
}
