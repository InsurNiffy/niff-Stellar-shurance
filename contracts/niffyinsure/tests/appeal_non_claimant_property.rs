//! Property coverage: `open_appeal` must return `NotEligibleVoter` for any
//! caller that is not the original claimant, regardless of who they are.

#![cfg(test)]

use niffyinsure::{types::VoteOption, validate::Error, NiffyInsureClient};
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
    let details = String::from_str(env, "non-claimant property test");
    let urls = vec![env];
    client.file_claim(holder, &1u32, &100_000i128, &details, &urls, &None)
}

/// Generates a batch of random non-claimant addresses and asserts open_appeal
/// always rejects them with NotEligibleVoter, across a rejected claim.
#[test]
fn open_appeal_rejects_random_non_claimant_addresses() {
    let (env, client) = setup();
    client.admin_set_quorum_bps(&10_000u32);

    let claimant = Address::generate(&env);
    let voter = Address::generate(&env);
    seed(&client, &claimant);
    seed(&client, &voter);

    let cid = file(&env, &client, &claimant);
    client.vote_on_claim(&claimant, &cid, &VoteOption::Reject);
    client.vote_on_claim(&voter, &cid, &VoteOption::Reject);

    for _ in 0..25 {
        let stranger = Address::generate(&env);
        assert_ne!(stranger, claimant);
        let err = client
            .try_open_appeal(&stranger, &cid)
            .err()
            .unwrap()
            .unwrap();
        assert_eq!(err, Error::NotEligibleVoter);
    }
}

/// A former voter on the original claim (but not the claimant) is still not
/// eligible to open the appeal.
#[test]
fn open_appeal_rejects_former_voter_who_is_not_claimant() {
    let (env, client) = setup();
    client.admin_set_quorum_bps(&10_000u32);

    let claimant = Address::generate(&env);
    let former_voter = Address::generate(&env);
    seed(&client, &claimant);
    seed(&client, &former_voter);

    let cid = file(&env, &client, &claimant);
    client.vote_on_claim(&claimant, &cid, &VoteOption::Reject);
    client.vote_on_claim(&former_voter, &cid, &VoteOption::Reject);
    assert_eq!(
        client.get_claim(&cid).status,
        niffyinsure::types::ClaimStatus::Rejected
    );

    let err = client
        .try_open_appeal(&former_voter, &cid)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::NotEligibleVoter);
}
