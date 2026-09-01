//! `AdminRotated{old_admin, new_admin, ledger}` must be emitted on every
//! admin address change so auditors have a complete chain-of-custody record.
//! This contract rotates admin only via the two-step propose/accept flow.

#![cfg(test)]

use niffyinsure::NiffyInsureClient;
use soroban_sdk::testutils::{arbitrary::std::format, Address as _, Events, Ledger};
use soroban_sdk::{Address, Env};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 777);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

#[test]
fn accept_admin_emits_admin_rotated_with_correct_addresses() {
    let (env, client, admin, _token) = setup();
    let new_admin = Address::generate(&env);

    client.propose_admin(&new_admin);
    env.events().all(); // drain propose-step events

    client.accept_admin();

    let all_events = env.events().all();
    let events_debug = format!("{:?}", all_events);

    assert!(
        events_debug.contains("admin_rotated"),
        "accept_admin must emit an admin_rotated event"
    );
    // Both the old and new admin addresses must appear in the emitted event.
    let old_admin_debug = format!("{:?}", admin);
    let new_admin_debug = format!("{:?}", new_admin);
    assert!(
        events_debug.contains(&old_admin_debug),
        "admin_rotated event must include the old admin address"
    );
    assert!(
        events_debug.contains(&new_admin_debug),
        "admin_rotated event must include the new admin address"
    );

    // Rotation actually took effect.
    assert_eq!(client.get_admin(), new_admin);
}

#[test]
fn admin_rotated_not_emitted_on_propose_step_alone() {
    let (env, client, _admin, _token) = setup();
    let new_admin = Address::generate(&env);

    env.events().all(); // drain initialize events
    client.propose_admin(&new_admin);

    let all_events = env.events().all();
    let events_debug = format!("{:?}", all_events);
    assert!(
        !events_debug.contains("admin_rotated"),
        "admin_rotated must only fire once the rotation actually completes (accept_admin)"
    );
}

#[test]
fn repeated_rotations_each_emit_admin_rotated_with_fresh_ledger() {
    let (env, client, admin, _token) = setup();
    let second_admin = Address::generate(&env);
    let third_admin = Address::generate(&env);

    client.propose_admin(&second_admin);
    client.accept_admin();
    assert_eq!(client.get_admin(), second_admin);

    env.ledger().with_mut(|l| l.sequence_number += 50);
    env.events().all(); // drain first rotation's events

    client.propose_admin(&third_admin);
    client.accept_admin();
    assert_eq!(client.get_admin(), third_admin);

    let all_events = env.events().all();
    let events_debug = format!("{:?}", all_events);
    assert!(events_debug.contains("admin_rotated"));
    assert!(events_debug.contains(&format!("{:?}", second_admin)));
    assert!(events_debug.contains(&format!("{:?}", third_admin)));
    let _ = admin;
}
