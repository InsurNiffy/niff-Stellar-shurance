//! Voter registry hard cap (`MAX_ELIGIBLE_VOTERS`):
//!   - Individual voter registration (`add_voter`) enforces the cap
//!     and reverts with `VoterRegistryFull` when exceeded.
//!   - Removal frees a slot; re-registration succeeds.
//!   - Boundary conditions at exactly `MAX_ELIGIBLE_VOTERS`.

#![cfg(test)]

use niffyinsure::{storage::MAX_ELIGIBLE_VOTERS, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Vec,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin)
}

/// Fill the registry to exactly MAX_ELIGIBLE_VOTERS via individual
/// add_voter calls, then assert the cap is reached.
#[test]
fn registration_at_cap_succeeds() {
    let (env, client, _admin) = setup();

    for _ in 0..MAX_ELIGIBLE_VOTERS {
        let voter = Address::generate(&env);
        client.test_add_voter(voter);
    }

    assert_eq!(client.voter_registry_len(), MAX_ELIGIBLE_VOTERS);
}

/// One more individual registration beyond the cap reverts with
/// VoterRegistryFull and the registry size is unchanged.
#[test]
fn registration_over_cap_reverts() {
    let (env, client, _admin) = setup();

    // Fill the registry to capacity.
    for _ in 0..MAX_ELIGIBLE_VOTERS {
        let voter = Address::generate(&env);
        client.test_add_voter(voter);
    }
    assert_eq!(client.voter_registry_len(), MAX_ELIGIBLE_VOTERS);

    // One more must revert.
    let over_cap = Address::generate(&env);
    let result = client.try_test_add_voter(&over_cap);
    assert!(result.is_err(), "registration over cap must revert");

    // Registry size is unchanged — no partial write.
    assert_eq!(client.voter_registry_len(), MAX_ELIGIBLE_VOTERS);
}

/// After removal, a previously freed slot can be reused by re-registering
/// the same address.
#[test]
fn removal_followed_by_re_registration_succeeds() {
    let (env, client, _admin) = setup();
    let voter = Address::generate(&env);

    // Register, remove, then re-register.
    client.test_add_voter(voter.clone());
    assert!(client.voter_registry_contains(&voter));

    client.admin_remove_voter(&voter);
    assert!(!client.voter_registry_contains(&voter));

    client.test_add_voter(voter.clone());
    assert!(client.voter_registry_contains(&voter));
    assert_eq!(client.voter_registry_len(), 1);
}

/// When the registry is full, removing one voter frees a slot so that
/// a new individual registration succeeds.
#[test]
fn removal_frees_slot_for_new_registration() {
    let (env, client, _admin) = setup();

    // Fill the registry to MAX_ELIGIBLE_VOTERS - 1.
    let mut voters = Vec::new(&env);
    for _ in 0..MAX_ELIGIBLE_VOTERS - 1 {
        let voter = Address::generate(&env);
        client.test_add_voter(voter.clone());
        voters.push_back(voter);
    }
    assert_eq!(client.voter_registry_len(), MAX_ELIGIBLE_VOTERS - 1);

    // Add one more to reach exactly the cap.
    let last_voter = Address::generate(&env);
    client.test_add_voter(last_voter.clone());
    assert_eq!(client.voter_registry_len(), MAX_ELIGIBLE_VOTERS);

    // Remove one voter to free a slot.
    let to_remove = voters.get(0).unwrap().clone();
    client.admin_remove_voter(&to_remove);
    assert_eq!(client.voter_registry_len(), MAX_ELIGIBLE_VOTERS - 1);

    // A new registration now succeeds because a slot was freed.
    let new_voter = Address::generate(&env);
    client.test_add_voter(new_voter);
    assert_eq!(client.voter_registry_len(), MAX_ELIGIBLE_VOTERS);
}
