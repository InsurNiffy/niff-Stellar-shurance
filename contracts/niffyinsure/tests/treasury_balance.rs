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
