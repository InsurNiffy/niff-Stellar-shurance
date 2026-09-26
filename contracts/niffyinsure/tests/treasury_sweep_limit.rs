//! Treasury sweep cap: per-ledger cumulative withdrawal limit (Issue #845).
//!
//! Acceptance criteria:
//! - Sweeps within the per-ledger cap succeed.
//! - A sweep exceeding the cap reverts.
//! - Cap resets on the next ledger sequence.
//! - Admin can set `max_sweep_per_ledger` (with bounds enforcement).

#![cfg(test)]

use niffyinsure::NiffyInsureClient;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 5_000);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token_addr);
    (env, client, admin, token_addr)
}

fn mint_to_contract(env: &Env, token: &Address, contract: &Address, amount: i128) {
    token::StellarAssetClient::new(env, token).mint(contract, &amount);
}

#[test]
fn set_max_sweep_per_ledger_succeeds() {
    let (_env, client, _admin, _token) = setup();
    assert!(client
        .try_admin_set_max_sweep_per_ledger(&500_000i128)
        .is_ok());
    assert_eq!(client.get_max_sweep_per_ledger(), Some(500_000i128));
}

#[test]
fn set_max_sweep_per_ledger_zero_fails() {
    let (_env, client, _admin, _token) = setup();
    // Zero is invalid (must be > 0).
    assert!(client.try_admin_set_max_sweep_per_ledger(&0i128).is_err());
}

#[test]
fn set_max_sweep_per_ledger_negative_fails() {
    let (_env, client, _admin, _token) = setup();
    assert!(client.try_admin_set_max_sweep_per_ledger(&-1i128).is_err());
}

#[test]
fn sweep_within_cap_succeeds() {
    let (env, client, _admin, token) = setup();
    let contract_id = client.address.clone();
    let recipient = Address::generate(&env);

    // Allow the asset and fund the contract.
    client.set_allowed_asset(
        &token,
        &true,
        &soroban_sdk::String::from_str(&env, "TKN"),
        &7u32,
    );
    mint_to_contract(&env, &token, &contract_id, 1_000_000i128);

    // Set a per-ledger cap of 500_000.
    client.admin_set_max_sweep_per_ledger(&500_000i128);

    // Sweep 400_000 – must succeed.
    client.sweep_token(&token, &recipient, &400_000i128, &1u32);
}

#[test]
fn sweep_exactly_at_cap_succeeds() {
    let (env, client, _admin, token) = setup();
    let contract_id = client.address.clone();
    let recipient = Address::generate(&env);

    client.set_allowed_asset(
        &token,
        &true,
        &soroban_sdk::String::from_str(&env, "TKN"),
        &7u32,
    );
    mint_to_contract(&env, &token, &contract_id, 1_000_000i128);
    client.admin_set_max_sweep_per_ledger(&500_000i128);

    // Sweep exactly the cap amount – must succeed.
    client.sweep_token(&token, &recipient, &500_000i128, &1u32);
}

#[test]
fn sweep_over_cap_reverts() {
    let (env, client, _admin, token) = setup();
    let contract_id = client.address.clone();
    let recipient = Address::generate(&env);

    client.set_allowed_asset(
        &token,
        &true,
        &soroban_sdk::String::from_str(&env, "TKN"),
        &7u32,
    );
    mint_to_contract(&env, &token, &contract_id, 2_000_000i128);
    client.admin_set_max_sweep_per_ledger(&500_000i128);

    // Sweep more than the cap – must revert.
    let result = client.try_sweep_token(&token, &recipient, &500_001i128, &1u32);
    assert!(result.is_err(), "sweep over cap must revert");
}

#[test]
fn two_sweeps_cumulative_over_cap_reverts() {
    let (env, client, _admin, token) = setup();
    let contract_id = client.address.clone();
    let recipient = Address::generate(&env);

    client.set_allowed_asset(
        &token,
        &true,
        &soroban_sdk::String::from_str(&env, "TKN"),
        &7u32,
    );
    mint_to_contract(&env, &token, &contract_id, 2_000_000i128);
    client.admin_set_max_sweep_per_ledger(&500_000i128);

    // First sweep: 300_000 – succeeds.
    client.sweep_token(&token, &recipient, &300_000i128, &1u32);

    // Second sweep in same ledger: 200_001 pushes cumulative to 500_001 – reverts.
    let result = client.try_sweep_token(&token, &recipient, &200_001i128, &1u32);
    assert!(result.is_err(), "cumulative sweep over cap must revert");
}

#[test]
fn cap_resets_on_next_ledger() {
    let (env, client, _admin, token) = setup();
    let contract_id = client.address.clone();
    let recipient = Address::generate(&env);

    client.set_allowed_asset(
        &token,
        &true,
        &soroban_sdk::String::from_str(&env, "TKN"),
        &7u32,
    );
    mint_to_contract(&env, &token, &contract_id, 2_000_000i128);
    client.admin_set_max_sweep_per_ledger(&500_000i128);

    // Use the full cap in ledger N.
    client.sweep_token(&token, &recipient, &500_000i128, &1u32);

    // Advance to the next ledger.
    env.ledger().with_mut(|l| l.sequence_number += 1);

    // Full cap again in ledger N+1 – must succeed.
    client.sweep_token(&token, &recipient, &500_000i128, &1u32);
}

#[test]
fn no_cap_allows_large_sweep() {
    let (env, client, _admin, token) = setup();
    let contract_id = client.address.clone();
    let recipient = Address::generate(&env);

    client.set_allowed_asset(
        &token,
        &true,
        &soroban_sdk::String::from_str(&env, "TKN"),
        &7u32,
    );
    mint_to_contract(&env, &token, &contract_id, 10_000_000i128);

    // No cap set → large sweep must succeed.
    client.sweep_token(&token, &recipient, &10_000_000i128, &1u32);
    assert_eq!(client.get_max_sweep_per_ledger(), None);
}
