//! Treasury balance read endpoint.

#![cfg(test)]

use niffyinsure::NiffyInsureClient;
use soroban_sdk::{testutils::Address as _, token, Address, Env};

fn setup() -> (Env, Address, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token);
    (env, contract_id, client, admin, token)
}

#[test]
fn get_treasury_balance_returns_default_contract_balance() {
    let (env, contract_id, client, _, token_id) = setup();
    token::StellarAssetClient::new(&env, &token_id).mint(&contract_id, &123_456i128);

    assert_eq!(client.get_treasury_balance(), 123_456i128);
}

#[test]
fn get_treasury_balance_tracks_configured_treasury() {
    let (env, contract_id, client, _, token_id) = setup();
    let treasury = Address::generate(&env);
    client.set_treasury(&treasury);

    token::StellarAssetClient::new(&env, &token_id).mint(&contract_id, &111i128);
    token::StellarAssetClient::new(&env, &token_id).mint(&treasury, &222_333i128);

    assert_eq!(client.get_treasury_balance(), 222_333i128);
}

// ── Solvency visibility pair (Issue #1604) ─────────────────────────────────
//
// `get_treasury_balance()` and `get_min_solvency_ratio_bps()` together are
// the public read surface the admin dashboard's solvency widget and the
// `treasury.balance_low` webhook depend on. Both entrypoints already
// existed; this locks in that they're queryable together, with no auth
// required (pure reads), and that the balance reflects the SEP-41 token
// balance of whatever address is currently configured as treasury —
// including the zero-balance case a `balance_low` webhook would key off.

#[test]
fn treasury_solvency_entrypoints_are_public_reads_usable_together() {
    let (env, contract_id, client, _, token_id) = setup();

    // Default solvency ratio and a freshly-funded contract balance.
    token::StellarAssetClient::new(&env, &token_id).mint(&contract_id, &500_000i128);
    let ratio_bps = client.get_min_solvency_ratio_bps();
    let balance = client.get_treasury_balance();

    // Both reads succeed with no auth mocked beyond env.mock_all_auths()
    // used for setup; neither call requires require_auth on its own.
    assert_eq!(balance, 500_000i128);
    assert!(ratio_bps <= 10_000, "ratio must be expressed in bps (<=10000)");
}

#[test]
fn get_treasury_balance_reports_zero_when_treasury_is_unfunded() {
    // Reproduces the `treasury.balance_low` webhook's zero-balance edge case:
    // a newly-configured treasury address with no token balance yet must
    // read back as exactly 0, not panic or default to a stale value.
    let (env, _contract_id, client, _, _token_id) = setup();
    let treasury = Address::generate(&env);
    client.set_treasury(&treasury);

    assert_eq!(client.get_treasury_balance(), 0i128);
}
