//! Governance cooldown: blocks rapid successive parameter changes (Issue #844).
//!
//! Acceptance criteria:
//! - Config changes within the cooldown window revert with `GovernanceCooldownActive`.
//! - Changes succeed once the cooldown has elapsed.
//! - Admin can set the cooldown window itself (with bounds enforcement).

#![cfg(test)]

use niffyinsure::{types, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
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

/// Set cooldown, then advance past it; cooldown default is 0 (disabled).
#[test]
fn default_cooldown_is_zero_allows_successive_changes() {
    let (_env, client, _admin) = setup();
    // With default cooldown (0), two rapid quorum changes must both succeed.
    assert!(client.try_admin_set_quorum_bps(&1_000u32).is_ok());
    assert!(client.try_admin_set_quorum_bps(&2_000u32).is_ok());
    assert_eq!(client.get_quorum_bps(), 2_000);
}

#[test]
fn set_governance_cooldown_succeeds_within_bounds() {
    let (_env, client, _admin) = setup();
    // 100 ledgers is well within the 30-day maximum.
    assert!(client.try_admin_set_gov_cooldown_ledgers(&100u32).is_ok());
    assert_eq!(client.get_governance_cooldown_ledgers(), 100);
}

#[test]
fn set_governance_cooldown_out_of_bounds_fails() {
    let (_env, client, _admin) = setup();
    // 30 days is niffyinsure::admin::MAX_GOVERNANCE_COOLDOWN_LEDGERS.
    // Exceed it: 30 * 17_280 + 1
    let too_large = 30u32 * 17_280u32 + 1;
    let result = client.try_admin_set_gov_cooldown_ledgers(&too_large);
    assert!(result.is_err());
}

#[test]
fn config_change_within_cooldown_reverts() {
    let (_env, client, _admin) = setup();
    // Set a 1_000-ledger cooldown, then immediately try to change quorum.
    client.admin_set_gov_cooldown_ledgers(&1_000u32);

    // Immediately try another change – must be blocked.
    let result = client.try_admin_set_quorum_bps(&500u32);
    assert!(result.is_err(), "second change within cooldown must revert");
}

#[test]
fn config_change_after_cooldown_succeeds() {
    let (env, client, _admin) = setup();
    let cooldown = 500u32;
    client.admin_set_gov_cooldown_ledgers(&cooldown);

    // Advance past the cooldown.
    env.ledger().with_mut(|l| {
        l.sequence_number = l.sequence_number.saturating_add(cooldown + 1);
    });

    let result = client.try_admin_set_quorum_bps(&500u32);
    assert!(result.is_ok(), "change after cooldown must succeed");
}

#[test]
fn cooldown_enforced_on_vote_duration_change() {
    let (env, client, _admin) = setup();
    let cooldown = 200u32;
    client.admin_set_gov_cooldown_ledgers(&cooldown);

    // Within cooldown: should fail.
    assert!(client
        .try_admin_set_vote_duration_ledgers(&types::MIN_VOTING_DURATION_LEDGERS)
        .is_err());

    // Past cooldown: should succeed.
    env.ledger().with_mut(|l| {
        l.sequence_number = l.sequence_number.saturating_add(cooldown + 1);
    });
    assert!(client
        .try_admin_set_vote_duration_ledgers(&types::MIN_VOTING_DURATION_LEDGERS)
        .is_ok());
}

#[test]
fn cooldown_enforced_on_rolling_claim_cap_change() {
    let (env, client, _admin) = setup();
    let cooldown = 300u32;
    client.admin_set_gov_cooldown_ledgers(&cooldown);

    // Within cooldown: should fail.
    assert!(client.try_set_rolling_claim_cap(&500_000i128).is_err());

    // Past cooldown: should succeed.
    env.ledger().with_mut(|l| {
        l.sequence_number = l.sequence_number.saturating_add(cooldown + 1);
    });
    assert!(client.try_set_rolling_claim_cap(&500_000i128).is_ok());
}

#[test]
fn cooldown_enforced_on_grace_period_change() {
    let (env, client, _admin) = setup();
    let cooldown = 400u32;
    client.admin_set_gov_cooldown_ledgers(&cooldown);

    // Within cooldown: should fail.
    let grace = types::MIN_GRACE_PERIOD_LEDGERS;
    assert!(client.try_set_grace_period_ledgers(&grace).is_err());

    // Past cooldown: should succeed.
    env.ledger().with_mut(|l| {
        l.sequence_number = l.sequence_number.saturating_add(cooldown + 1);
    });
    assert!(client.try_set_grace_period_ledgers(&grace).is_ok());
}

#[test]
fn cooldown_set_to_zero_disables_enforcement() {
    let (env, client, _admin) = setup();
    // First enable, then immediately disable.
    client.admin_set_gov_cooldown_ledgers(&500u32);

    // Advance past cooldown to allow next change.
    env.ledger().with_mut(|l| {
        l.sequence_number = l.sequence_number.saturating_add(501);
    });

    // Disable cooldown.
    client.admin_set_gov_cooldown_ledgers(&0u32);

    // Now rapid changes must succeed.
    assert!(client.try_admin_set_quorum_bps(&1_000u32).is_ok());
    assert!(client.try_admin_set_quorum_bps(&2_000u32).is_ok());
}
