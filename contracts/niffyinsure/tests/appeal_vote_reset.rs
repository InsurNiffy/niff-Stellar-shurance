//! `open_appeal` must reset the appeal tallies to 0 while preserving the
//! original claim's vote tallies for audit purposes.

#![cfg(test)]

use niffyinsure::{types::VoteOption, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env, String,
};

fn setup() -> (Env, NiffyInsureClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client)
}

fn seed(client: &NiffyInsureClient, holder: &Address) {
    client.test_seed_policy(holder, &1u32, &1_000_000i128, &500_000u32);
}

fn file(env: &Env, client: &NiffyInsureClient, holder: &Address) -> u64 {
    let details = String::from_str(env, "vote reset test");
    let urls = vec![env];
    client.file_claim(holder, &1u32, &100_000i128, &details, &urls, &None)
}

#[test]
fn open_appeal_resets_appeal_tallies_and_preserves_original_tallies() {
    let (env, client) = setup();

    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1);
    seed(&client, &v2);
    seed(&client, &v3);

    let cid = file(&env, &client, &v1);

    // Nonzero original approve/reject tallies: quorum (2 of 3) is met on the
    // 2nd vote with a 1-1 tie, which resolves to Rejected (insurer wins ties).
    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);
    let _ = &v3;

    let before = client.get_claim(&cid);
    assert_eq!(before.approve_votes, 1);
    assert_eq!(before.reject_votes, 1);

    client.open_appeal(&v1, &cid);

    let after = client.get_claim(&cid);
    assert_eq!(
        after.appeal_approve_votes, 0,
        "appeal_approve_votes must start at 0"
    );
    assert_eq!(
        after.appeal_reject_votes, 0,
        "appeal_reject_votes must start at 0"
    );

    // Original tallies must be untouched for audit purposes.
    assert_eq!(after.approve_votes, before.approve_votes);
    assert_eq!(after.reject_votes, before.reject_votes);
}
