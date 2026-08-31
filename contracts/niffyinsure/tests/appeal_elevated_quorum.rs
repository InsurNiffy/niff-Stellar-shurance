//! Appeal rounds must require strictly more participation than the base
//! claim vote (`APPEAL_ELEVATED_QUORUM_BPS` vs. the admin-configured base
//! `quorum_bps`).

#![cfg(test)]

use niffyinsure::{
    types::{ClaimStatus, VoteOption, APPEAL_VOTE_WINDOW_LEDGERS},
    NiffyInsureClient,
};
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
    let details = String::from_str(env, "elevated quorum test");
    let urls = vec![env];
    client.file_claim(holder, &1u32, &100_000i128, &details, &urls, &None)
}

/// Base quorum (40%) is strictly lower than the elevated appeal quorum (75%).
/// With 5 eligible voters: base requires 2 ballots, the appeal round requires 4.
#[test]
fn appeal_round_requires_more_participation_than_base_vote() {
    let (env, client) = setup();
    client.admin_set_quorum_bps(&4_000u32);

    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    let v4 = Address::generate(&env);
    let v5 = Address::generate(&env);
    for v in [&v1, &v2, &v3, &v4, &v5] {
        seed(&client, v);
    }

    // Original claim: 2 reject votes meets the base quorum (2 of 5) and rejects.
    let cid = file(&env, &client, &v1);
    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);

    // Open the appeal as the claimant.
    client.open_appeal(&v1, &cid);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::UnderAppeal);

    // Cast the same number of approve votes (2) that would have satisfied the
    // *base* quorum — this must NOT be enough to resolve the appeal.
    client.vote_on_appeal(&v1, &cid, &VoteOption::Approve);
    let status = client.vote_on_appeal(&v2, &cid, &VoteOption::Approve);
    assert_eq!(
        status,
        ClaimStatus::UnderAppeal,
        "2 of 5 votes met the base quorum but must not meet the elevated appeal quorum"
    );

    // At the deadline with only base-quorum-level participation, finalize_appeal
    // must NOT resolve to AppealApproved even though approve > reject.
    env.ledger()
        .with_mut(|l| l.sequence_number += APPEAL_VOTE_WINDOW_LEDGERS + 1);
    let outcome = client.finalize_appeal(&cid);
    assert_eq!(
        outcome,
        ClaimStatus::AppealRejected,
        "elevated quorum unmet ⇒ finalize_appeal must not approve the appeal"
    );
}

/// When the elevated quorum IS met, the appeal resolves in favor of the majority.
#[test]
fn appeal_resolves_once_elevated_quorum_is_met() {
    let (env, client) = setup();
    client.admin_set_quorum_bps(&4_000u32);

    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    let v4 = Address::generate(&env);
    let v5 = Address::generate(&env);
    for v in [&v1, &v2, &v3, &v4, &v5] {
        seed(&client, v);
    }

    let cid = file(&env, &client, &v1);
    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);

    client.open_appeal(&v1, &cid);

    // 4 of 5 votes meets the elevated 75% quorum (ceil(5 * 7500 / 10000) = 4).
    client.vote_on_appeal(&v1, &cid, &VoteOption::Approve);
    client.vote_on_appeal(&v2, &cid, &VoteOption::Approve);
    client.vote_on_appeal(&v3, &cid, &VoteOption::Approve);
    let status = client.vote_on_appeal(&v4, &cid, &VoteOption::Approve);
    assert_eq!(status, ClaimStatus::AppealApproved);
}
