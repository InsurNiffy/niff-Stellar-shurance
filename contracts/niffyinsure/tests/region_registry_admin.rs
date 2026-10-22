//! Region registry admin entrypoints (Issue #1608).
//!
//! Covers `upsert_region` / `remove_region`: create, update, remove, admin-only
//! auth, region-code length validation, config validation, unknown-region
//! removal, and the `region_upserted` / `region_removed` events.

#![cfg(test)]

use niffyinsure::{
    events::{RegionRemovedData, RegionUpsertedData},
    types::{RegionConfig, REGION_CODE_MAX_LEN},
    NiffyInsureClient, RegionError,
};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    xdr, Address, Env, Event, String,
};

extern crate std;

fn setup() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 500);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin)
}

fn cfg(env: &Env, parent: &str, risk_multiplier: i128, active: bool) -> RegionConfig {
    RegionConfig {
        parent: String::from_str(env, parent),
        risk_multiplier,
        active,
    }
}

/// Events from the most recent top-level invocation only (SDK semantics), so
/// callers must inspect events right after the mutating call.
fn contract_events(env: &Env, client: &NiffyInsureClient) -> std::vec::Vec<xdr::ContractEvent> {
    env.events()
        .all()
        .filter_by_contract(&client.address)
        .events()
        .to_vec()
}

fn assert_emitted_once(env: &Env, client: &NiffyInsureClient, expected: &xdr::ContractEvent) {
    let events = contract_events(env, client);
    let hits = events.iter().filter(|e| *e == expected).count();
    assert_eq!(
        hits, 1,
        "expected event not emitted exactly once: {:?}",
        events
    );
}

fn code_of_len(env: &Env, len: u32) -> String {
    let s: std::string::String = "A".repeat(len as usize);
    String::from_str(env, &s)
}

#[test]
fn upsert_creates_region() {
    let (env, client, _admin) = setup();
    let region = String::from_str(&env, "US-CA");
    let config = cfg(&env, "US", 12_000, true);

    assert_eq!(client.get_region_config(&region), None);
    client.upsert_region(&region, &config);

    let expected = RegionUpsertedData {
        region: region.clone(),
        version: 1,
        parent: config.parent.clone(),
        risk_multiplier: 12_000,
        active: 1,
        created: 1,
        at_ledger: 500,
    }
    .to_xdr(&env, &client.address);
    assert_emitted_once(&env, &client, &expected);
    assert_eq!(client.get_region_config(&region), Some(config));
}

#[test]
fn upsert_updates_existing_region() {
    let (env, client, _admin) = setup();
    let region = String::from_str(&env, "US-CA");
    client.upsert_region(&region, &cfg(&env, "US", 12_000, true));

    env.ledger().with_mut(|l| l.sequence_number = 510);
    let updated = cfg(&env, "", 15_000, false);
    client.upsert_region(&region, &updated);

    let expected = RegionUpsertedData {
        region: region.clone(),
        version: 1,
        parent: String::from_str(&env, ""),
        risk_multiplier: 15_000,
        active: 0,
        created: 0,
        at_ledger: 510,
    }
    .to_xdr(&env, &client.address);
    assert_emitted_once(&env, &client, &expected);
    assert_eq!(client.get_region_config(&region), Some(updated));
}

#[test]
fn remove_deletes_region_and_emits_event() {
    let (env, client, _admin) = setup();
    let region = String::from_str(&env, "GB-ENG");
    let other = String::from_str(&env, "GB-SCT");
    client.upsert_region(&region, &cfg(&env, "GB", 10_000, true));
    client.upsert_region(&other, &cfg(&env, "GB", 10_000, true));

    client.remove_region(&region);

    let expected = RegionRemovedData {
        region: region.clone(),
        version: 1,
        at_ledger: 500,
    }
    .to_xdr(&env, &client.address);
    assert_emitted_once(&env, &client, &expected);

    assert_eq!(client.get_region_config(&region), None);
    assert!(
        client.get_region_config(&other).is_some(),
        "other regions must be untouched"
    );
}

#[test]
fn remove_unknown_region_returns_not_found_without_event() {
    let (env, client, _admin) = setup();
    let region = String::from_str(&env, "XX");
    let res = client.try_remove_region(&region);
    assert_eq!(res, Err(Ok(RegionError::RegionNotFound)));
    let dbg = std::format!("{:?}", contract_events(&env, &client));
    assert!(!dbg.contains("region_removed"), "{dbg}");

    // Removing twice: second call also reports not found.
    let known = String::from_str(&env, "FR");
    client.upsert_region(&known, &cfg(&env, "", 10_000, true));
    client.remove_region(&known);
    assert_eq!(
        client.try_remove_region(&known),
        Err(Ok(RegionError::RegionNotFound))
    );
}

#[test]
fn non_admin_cannot_upsert_or_remove() {
    let (env, client, _admin) = setup();
    let region = String::from_str(&env, "DE");
    let config = cfg(&env, "", 10_000, true);
    client.upsert_region(&region, &config);

    // Drop all mocked auths: admin.require_auth() must now fail.
    env.mock_auths(&[]);
    assert!(client
        .try_upsert_region(&String::from_str(&env, "IT"), &config)
        .is_err());
    assert!(client.try_remove_region(&region).is_err());

    // State unchanged.
    assert_eq!(client.get_region_config(&region), Some(config));
    assert_eq!(
        client.get_region_config(&String::from_str(&env, "IT")),
        None
    );
}

#[test]
fn region_code_at_max_len_is_accepted() {
    let (env, client, _admin) = setup();
    let region = code_of_len(&env, REGION_CODE_MAX_LEN);
    client.upsert_region(&region, &cfg(&env, "", 10_000, true));
    assert!(client.get_region_config(&region).is_some());
}

#[test]
fn region_code_too_long_is_rejected() {
    let (env, client, _admin) = setup();
    let region = code_of_len(&env, REGION_CODE_MAX_LEN + 1);
    assert_eq!(
        client.try_upsert_region(&region, &cfg(&env, "", 10_000, true)),
        Err(Ok(RegionError::RegionCodeTooLong))
    );
    assert_eq!(
        client.try_remove_region(&region),
        Err(Ok(RegionError::RegionCodeTooLong))
    );
    assert_eq!(client.get_region_config(&region), None);
}

#[test]
fn empty_region_code_is_rejected() {
    let (env, client, _admin) = setup();
    let region = String::from_str(&env, "");
    assert_eq!(
        client.try_upsert_region(&region, &cfg(&env, "US", 10_000, true)),
        Err(Ok(RegionError::EmptyRegionCode))
    );
}

#[test]
fn invalid_config_is_rejected() {
    let (env, client, _admin) = setup();
    let region = String::from_str(&env, "US-NY");

    let long_parent = std::string::String::from("P").repeat(REGION_CODE_MAX_LEN as usize + 1);
    assert_eq!(
        client.try_upsert_region(&region, &cfg(&env, &long_parent, 10_000, true)),
        Err(Ok(RegionError::ParentCodeTooLong))
    );
    assert_eq!(
        client.try_upsert_region(&region, &cfg(&env, "US-NY", 10_000, true)),
        Err(Ok(RegionError::SelfParent))
    );
    assert_eq!(
        client.try_upsert_region(
            &region,
            &cfg(&env, "US", niffyinsure::premium::MIN_MULTIPLIER - 1, true)
        ),
        Err(Ok(RegionError::RiskMultiplierOutOfBounds))
    );
    assert_eq!(
        client.try_upsert_region(
            &region,
            &cfg(&env, "US", niffyinsure::premium::MAX_MULTIPLIER + 1, true)
        ),
        Err(Ok(RegionError::RiskMultiplierOutOfBounds))
    );
    assert_eq!(client.get_region_config(&region), None);
}

#[test]
fn rejected_upsert_emits_no_region_event() {
    let (env, client, _admin) = setup();
    let region = code_of_len(&env, REGION_CODE_MAX_LEN + 1);
    let _ = client.try_upsert_region(&region, &cfg(&env, "", 10_000, true));
    let events = contract_events(&env, &client);
    let dbg = std::format!("{:?}", events);
    assert!(!dbg.contains("region_upserted"), "{dbg}");
}

#[test]
fn legacy_aliases_delegate_to_new_entrypoints() {
    let (env, client, _admin) = setup();
    let region = String::from_str(&env, "JP");
    let config = cfg(&env, "", 11_000, true);
    client.admin_set_region(&region, &config);
    assert_eq!(client.get_region_config(&region), Some(config));
    client.admin_remove_region(&region);
    assert_eq!(client.get_region_config(&region), None);
    assert_eq!(
        client.try_admin_set_region(
            &code_of_len(&env, REGION_CODE_MAX_LEN + 1),
            &cfg(&env, "", 11_000, true)
        ),
        Err(Ok(RegionError::RegionCodeTooLong))
    );
}
