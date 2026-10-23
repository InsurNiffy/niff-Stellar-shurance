//! Regression tests for Issue #1600 (governance proposal expiry — auto-reject
//! proposals past deadline).
//!
//! `finalize_governance_proposal(proposal_id)` is the permissionless keeper
//! that closes out a proposal once `env.ledger().sequence() > deadline`
//! without it having reached quorum: it removes the stale proposal and
//! emits `proposal_expired`, and refuses to touch a proposal that is still
//! open or that already applied.
//!
//! This file focuses on a scenario not covered elsewhere: finalizing one
//! expired proposal must have zero effect on an unrelated, still-open
//! proposal from a different proposer — the keeper must only ever touch the
//! single id it was given, never sweep or disturb other governance state.

#![cfg(test)]

use niffyinsure::{GovernanceError, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin)
}

fn seed_proposer(env: &Env, client: &NiffyInsureClient, proposer: &Address) {
    client.test_seed_policy(proposer, &1u32, &1_000_000i128, &500_000u32);
    let _ = env;
}

/// Two proposals from two different proposers, created at different times
/// so they have different deadlines. Advancing past only the first
/// proposal's deadline and finalizing it must leave the second, still-open
/// proposal completely untouched.
#[test]
fn finalizing_one_expired_proposal_does_not_affect_an_unrelated_open_one() {
    let (env, client, _admin) = setup();
    let proposer_a = Address::generate(&env);
    let proposer_b = Address::generate(&env);
    seed_proposer(&env, &client, &proposer_a);
    seed_proposer(&env, &client, &proposer_b);

    let id_a = client.create_proposal(&proposer_a, &String::from_str(&env, "quorum_bps"), &5_000u32);

    // Advance a bit, then create the second proposal so its deadline is
    // strictly later than proposal A's.
    env.ledger().with_mut(|l| l.sequence_number += 10);
    let id_b = client.create_proposal(
        &proposer_b,
        &String::from_str(&env, "voting_duration_ledgers"),
        &200u32,
    );

    let deadline_a = client.get_proposal(&id_a).unwrap().deadline;
    let deadline_b = client.get_proposal(&id_b).unwrap().deadline;
    assert!(deadline_b > deadline_a, "B must deadline strictly later than A");

    // Advance past A's deadline but strictly before B's.
    env.ledger().with_mut(|l| l.sequence_number = deadline_a + 1);
    assert!(
        env.ledger().sequence() <= deadline_b,
        "test setup must land before B's deadline"
    );

    client.finalize_governance_proposal(&id_a);

    // A is gone.
    assert!(client.get_proposal(&id_a).is_none());
    // B is completely unaffected: still present, same deadline, same values.
    let b_after = client.get_proposal(&id_b).unwrap();
    assert_eq!(b_after.deadline, deadline_b);
    assert_eq!(b_after.approve_votes, 0);
    assert_eq!(b_after.reject_votes, 0);
    assert!(!b_after.applied);

    // B itself is correctly still too early to finalize.
    let result = client.try_finalize_governance_proposal(&id_b);
    assert_eq!(result, Err(Ok(GovernanceError::ProposalNotExpired)));
}

/// Sanity check on the core guard: finalizing before the deadline reverts,
/// and after it the proposal is removed and the event-driving state (param
/// key, proposed value) is readable one last time before removal.
#[test]
fn finalize_before_and_after_deadline() {
    let (env, client, _admin) = setup();
    let proposer = Address::generate(&env);
    seed_proposer(&env, &client, &proposer);

    let id = client.create_proposal(&proposer, &String::from_str(&env, "quorum_bps"), &6_000u32);
    let proposal = client.get_proposal(&id).unwrap();

    let early = client.try_finalize_governance_proposal(&id);
    assert_eq!(early, Err(Ok(GovernanceError::ProposalNotExpired)));

    env.ledger()
        .with_mut(|l| l.sequence_number = proposal.deadline + 1);
    client.finalize_governance_proposal(&id);
    assert!(client.get_proposal(&id).is_none());

    // Idempotency: a second finalize on the now-removed id is NotFound, not
    // a silent success.
    let twice = client.try_finalize_governance_proposal(&id);
    assert_eq!(twice, Err(Ok(GovernanceError::ProposalNotFound)));
}
