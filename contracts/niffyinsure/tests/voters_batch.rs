//! Batch voter registration (`add_voters_batch`): reduces per-address admin
//! transaction overhead for initial protocol setup and large governance
//! migrations.
//!
//! Covers:
//!   - Admin-only authentication.
//!   - A full batch within `MAX_ELIGIBLE_VOTERS` succeeds and every address
//!     is added to the voter registry.
//!   - A batch that would push the registry past the cap reverts entirely,
//!     with zero partial writes (atomicity).
//!   - Duplicate addresses within a batch, and addresses already registered,
//!     are handled without storage corruption (no duplicate entries, no
//!     double-counted registry size).
//!   - Exactly one `VoterAdded` event is emitted per address actually added.

#![cfg(test)]

use niffyinsure::{storage::MAX_ELIGIBLE_VOTERS, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Events},
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

fn addresses(env: &Env, n: u32) -> Vec<Address> {
    let mut v = Vec::new(env);
    for _ in 0..n {
        v.push_back(Address::generate(env));
    }
    v
}

/// A batch of unique addresses within the cap succeeds; every address ends
/// up in the voter registry.
#[test]
fn full_batch_within_cap_succeeds() {
    let (env, client, _admin) = setup();
    let batch = addresses(&env, 25);

    client.add_voters_batch(&batch);

    let voters = client.get_voters();
    assert_eq!(voters.len(), 25);
    for addr in batch.iter() {
        assert!(voters.iter().any(|v| v == addr));
    }
}

/// One `VoterAdded` event is emitted per address added.
#[test]
fn emits_one_event_per_address() {
    let (env, client, _admin) = setup();
    let batch = addresses(&env, 5);

    let before = env.events().all().events().len();
    client.add_voters_batch(&batch);
    let after = env.events().all().events().len();

    assert_eq!(
        after - before,
        5,
        "expected exactly one VoterAdded event per new address"
    );
}

/// Duplicate addresses within a single batch are collapsed to one entry —
/// no storage corruption, no double-count of the registry.
#[test]
fn duplicate_entries_within_batch_are_deduplicated() {
    let (env, client, _admin) = setup();
    let addr = Address::generate(&env);
    let mut batch = Vec::new(&env);
    batch.push_back(addr.clone());
    batch.push_back(addr.clone());
    batch.push_back(addr.clone());

    client.add_voters_batch(&batch);

    let voters = client.get_voters();
    let count = voters.iter().filter(|v| v == &addr).count();
    assert_eq!(count, 1, "duplicate address must appear exactly once");
    assert_eq!(voters.len(), 1);
}

/// An address already registered (from a prior batch) is skipped, not
/// re-added, on a subsequent batch that includes it again.
#[test]
fn already_registered_address_is_skipped_on_second_batch() {
    let (env, client, _admin) = setup();
    let addr = Address::generate(&env);
    let mut first = Vec::new(&env);
    first.push_back(addr.clone());
    client.add_voters_batch(&first);
    assert_eq!(client.get_voters().len(), 1);

    let mut second = Vec::new(&env);
    second.push_back(addr.clone());
    second.push_back(Address::generate(&env));
    client.add_voters_batch(&second);

    let voters = client.get_voters();
    assert_eq!(voters.len(), 2, "the already-registered address must not be duplicated");
}

/// A batch that would push the registry past `MAX_ELIGIBLE_VOTERS` reverts
/// entirely — no address from the oversized batch is written.
#[test]
fn batch_exceeding_cap_reverts_atomically() {
    let (env, client, _admin) = setup();
    let batch = addresses(&env, MAX_ELIGIBLE_VOTERS + 1);

    let result = client.try_add_voters_batch(&batch);
    assert!(result.is_err(), "batch exceeding the cap must revert");

    // Zero partial writes: registry is still empty.
    assert_eq!(client.get_voters().len(), 0);
}

/// A batch landing exactly on the cap succeeds (inclusive upper bound).
#[test]
fn batch_landing_exactly_on_cap_succeeds() {
    let (env, client, _admin) = setup();
    let batch = addresses(&env, MAX_ELIGIBLE_VOTERS);

    client.add_voters_batch(&batch);

    assert_eq!(client.get_voters().len(), MAX_ELIGIBLE_VOTERS);
}
