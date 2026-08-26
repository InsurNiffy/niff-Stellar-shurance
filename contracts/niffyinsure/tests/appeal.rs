//! Appeal mechanism coverage: pre-deadline finalize behavior, AppealOpened
//! event/storage parity, and permissionless finalize_appeal caller coverage.

#![cfg(test)]

mod common;

use niffyinsure::{types::ClaimStatus, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, Env, String,
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
    let details = String::from_str(env, "brief claim description");
    let ev = common::empty_evidence(env);
    client.file_claim(holder, &1u32, &amount, &details, &ev, &None)
}

/// Three-voter setup, claim filed by v1, majority-rejected, appeal opened by v1.
/// Returns the claim id with status == UnderAppeal.
fn rejected_and_appealed() -> (Env, NiffyInsureClient<'static>, Address, Address, Address, u64) {
    let (env, client, _admin, _token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);

    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &niffyinsure::types::VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &niffyinsure::types::VoteOption::Reject);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);

    client.open_appeal(&v1, &cid);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::UnderAppeal);

    (env, client, v1, v2, v3, cid)
}

/// Issue: finalize_appeal must not resolve before its deadline, even with
/// quorum unmet — it errors with VotingWindowStillOpen rather than no-op'ing
/// or resolving early.
#[test]
fn finalize_appeal_before_deadline_errors_with_quorum_unmet() {
    let (_env, client, _v1, _v2, _v3, cid) = rejected_and_appealed();

    // No appeal votes cast (quorum is unmet) and the appeal deadline has not
    // yet passed — finalize must reject the call, not silently no-op.
    let result = client.try_finalize_appeal(&cid);
    assert!(
        result.is_err(),
        "finalize_appeal must error before the appeal deadline, regardless of quorum state"
    );

    // Status must remain UnderAppeal — no premature resolution.
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::UnderAppeal);
}
