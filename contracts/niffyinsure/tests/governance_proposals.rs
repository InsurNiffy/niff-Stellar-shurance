//! Governance proposals: per-proposer cooldown, double-vote, payload validation,
//! and event emission (Issue #1450).

#![cfg(test)]

use niffyinsure::{GovernanceError, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 10_000);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin)
}

/// Seed a proposer with an active policy so `require_token_holder` passes.
fn seed_proposer(env: &Env, client: &NiffyInsureClient, proposer: &Address) {
    client.test_seed_policy(proposer, &1u32, &1_000_000i128, &100_000u32);
}

#[test]
fn create_proposal_succeeds_for_token_holder() {
    let (env, client, _admin) = setup();
    let proposer = Address::generate(&env);
    seed_proposer(&env, &client, &proposer);

    let id = client.create_proposal(&proposer, &String::from_str(&env, "quorum_bps"), &5_000u32);
    assert!(id > 0);
    assert!(client.get_proposal(&id).is_some());
}

#[test]
fn create_proposal_fails_for_non_holder() {
    let (env, client, _admin) = setup();
    let non_holder = Address::generate(&env);
    // No policy seeded — not a token holder.
    let result =
        client.try_create_proposal(&non_holder, &String::from_str(&env, "quorum_bps"), &5_000u32);
    assert!(result.is_err());
}

#[test]
fn create_proposal_rejects_invalid_param_key() {
    let (env, client, _admin) = setup();
    let proposer = Address::generate(&env);
    seed_proposer(&env, &client, &proposer);

    let result = client.try_create_proposal(
        &proposer,
        &String::from_str(&env, "unknown_param"),
        &1_000u32,
    );
    assert!(result.is_err());
}

#[test]
fn create_proposal_rejects_invalid_payload_value() {
    let (env, client, _admin) = setup();
    let proposer = Address::generate(&env);
    seed_proposer(&env, &client, &proposer);

    // quorum_bps must be in [1, 10_000]; 0 is invalid.
    let result =
        client.try_create_proposal(&proposer, &String::from_str(&env, "quorum_bps"), &0u32);
    assert!(result.is_err());
}

#[test]
fn double_vote_on_proposal_fails() {
    let (env, client, _admin) = setup();
    let proposer = Address::generate(&env);
    seed_proposer(&env, &client, &proposer);

    let id = client.create_proposal(&proposer, &String::from_str(&env, "quorum_bps"), &5_000u32);
    client.vote_proposal(&proposer, &id, &true).unwrap();

    let result = client.try_vote_proposal(&proposer, &id, &false);
    assert!(result.is_err());
}

#[test]
fn proposal_passes_and_applies_quorum_change() {
    let (env, client, _admin) = setup();
    let proposer = Address::generate(&env);
    seed_proposer(&env, &client, &proposer);

    client.add_voters_batch(&soroban_sdk::vec![&env, proposer.clone()]).unwrap();

    let id = client.create_proposal(&proposer, &String::from_str(&env, "quorum_bps"), &3_000u32);
    client.vote_proposal(&proposer, &id, &true).unwrap();

    // One voter = quorum of 1 — proposal should now be applied.
    assert_eq!(client.get_quorum_bps(), 3_000);
}

#[test]
fn per_proposer_cooldown_blocks_rapid_proposals() {
    let (env, client, admin) = setup();
    let proposer = Address::generate(&env);
    seed_proposer(&env, &client, &proposer);

    // Admin sets a 500-ledger per-proposer cooldown.
    client.admin_set_proposer_cooldown(&500u32).unwrap();

    // First proposal is fine.
    let _id =
        client.create_proposal(&proposer, &String::from_str(&env, "quorum_bps"), &5_000u32);

    // Immediate second proposal from same address must fail.
    let result =
        client.try_create_proposal(&proposer, &String::from_str(&env, "quorum_bps"), &6_000u32);
    assert!(
        result.is_err(),
        "second proposal within cooldown must revert with ProposerCooldownActive"
    );

    // A different proposer is not affected.
    let proposer2 = Address::generate(&env);
    seed_proposer(&env, &client, &proposer2);
    let result2 =
        client.try_create_proposal(&proposer2, &String::from_str(&env, "quorum_bps"), &5_000u32);
    assert!(result2.is_ok(), "different proposer must not be blocked");

    let _ = admin; // silence unused warning
}

#[test]
fn per_proposer_cooldown_lifts_after_window() {
    let (env, client, _admin) = setup();
    let proposer = Address::generate(&env);
    seed_proposer(&env, &client, &proposer);

    client.admin_set_proposer_cooldown(&200u32).unwrap();

    let _id =
        client.create_proposal(&proposer, &String::from_str(&env, "quorum_bps"), &5_000u32);

    // Advance past cooldown.
    env.ledger().with_mut(|l| {
        l.sequence_number = l.sequence_number.saturating_add(201);
    });

    let result =
        client.try_create_proposal(&proposer, &String::from_str(&env, "quorum_bps"), &6_000u32);
    assert!(result.is_ok(), "proposal after cooldown must succeed");
}

#[test]
fn admin_set_proposer_cooldown_out_of_bounds_fails() {
    let (_env, client, _admin) = setup();
    // 7 days + 1 ledger exceeds MAX_PROPOSER_COOLDOWN_LEDGERS.
    let too_large = 7u32 * 17_280u32 + 1;
    let result = client.try_admin_set_proposer_cooldown(&too_large);
    assert!(result.is_err());
}

#[test]
fn cooldown_zero_disables_per_proposer_limit() {
    let (env, client, _admin) = setup();
    let proposer = Address::generate(&env);
    seed_proposer(&env, &client, &proposer);

    // Ensure cooldown is 0 (default) — rapid proposals must succeed.
    assert_eq!(client.get_proposer_cooldown(), 0);
    client.create_proposal(&proposer, &String::from_str(&env, "quorum_bps"), &5_000u32);
    let result =
        client.try_create_proposal(&proposer, &String::from_str(&env, "quorum_bps"), &6_000u32);
    assert!(result.is_ok(), "zero cooldown must allow rapid proposals");
}
