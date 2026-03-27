//! Event shape regression tests.
//!
//! Each test asserts the exact topic layout and payload fields for a lifecycle
//! path. If an event struct changes shape, these tests fail CI intentionally —
//! treat a failure here as a semver-major signal requiring a version bump in
//! `EVENT_SCHEMA_VERSION` and a parser migration in the NestJS indexer.
//!
//! # How to read failures
//! A panic in `from_val` means the payload type no longer matches the struct.
//! A wrong field value means the emitter is passing incorrect data.
//! A wrong topic count means the topic layout changed (breaking for indexers).

#![cfg(test)]

use niffyinsure::{
    events::{
        AdminAcceptedData, AdminCancelledData, AdminProposedData, AssetAllowlistedData,
        ClaimFiledData, ClaimFinalizedData, ClaimPaidData, DrainedData, PauseToggledData,
        PremiumTableUpdatedData, TokenUpdatedData, VoteCastData, EVENT_SCHEMA_VERSION,
    },
    types::{ClaimStatus, VoteOption},
    NiffyInsureClient,
};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger},
    vec, Address, Env, FromVal, String, Val,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let cid = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &cid);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

fn seed(client: &NiffyInsureClient, holder: &Address, coverage: i128, end_ledger: u32) {
    client.test_seed_policy(holder, &1u32, &coverage, &end_ledger);
}

fn file(client: &NiffyInsureClient, holder: &Address, amount: i128, env: &Env) -> u64 {
    let details = String::from_str(env, "test claim");
    let urls = vec![env];
    client.file_claim(holder, &1u32, &amount, &details, &urls)
}

/// Find the last event whose topics start with the given two symbols.
/// Returns `(topics: Vec<Val>, data: Val)`.
fn find_event<'a>(
    env: &Env,
    ns: &str,
    name: &str,
) -> (soroban_sdk::Vec<Val>, Val) {
    let ns_sym = symbol_short!(ns);
    let name_sym = soroban_sdk::Symbol::new(env, name);
    env.events()
        .all()
        .iter()
        .rev()
        .find(|(topics, _)| {
            topics.len() >= 2
                && topics.get(0) == Some(soroban_sdk::IntoVal::<Env, Val>::into_val(&ns_sym, env))
                && topics.get(1) == Some(soroban_sdk::IntoVal::<Env, Val>::into_val(&name_sym, env))
        })
        .expect("event not found")
}

// ── Claim events ──────────────────────────────────────────────────────────────

#[test]
fn evt_clm_filed_shape() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 50_000);
    file(&client, &holder, 100_000, &env);

    let (topics, data) = find_event(&env, "niffyins", "clm_filed");

    // topics: (NS, "clm_filed", claim_id: u64, holder: Address)
    assert_eq!(topics.len(), 4);
    let claim_id = u64::from_val(&env, &topics.get(2).unwrap());
    assert_eq!(claim_id, 1u64);
    let topic_holder = Address::from_val(&env, &topics.get(3).unwrap());
    assert_eq!(topic_holder, holder);

    let payload = ClaimFiledData::from_val(&env, &data);
    assert_eq!(payload.version, EVENT_SCHEMA_VERSION);
    assert_eq!(payload.policy_id, 1u32);
    assert_eq!(payload.amount, 100_000i128);
    // image_hash is deterministic for empty url list
    assert_eq!(payload.filed_at, env.ledger().sequence());
}

#[test]
fn evt_vote_cast_shape() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 50_000);
    let cid = file(&client, &holder, 100_000, &env);
    client.vote_on_claim(&holder, &cid, &VoteOption::Approve);

    let (topics, data) = find_event(&env, "niffyins", "vote_cast");

    // topics: (NS, "vote_cast", claim_id: u64, voter: Address)
    assert_eq!(topics.len(), 4);
    let claim_id = u64::from_val(&env, &topics.get(2).unwrap());
    assert_eq!(claim_id, cid);
    let voter = Address::from_val(&env, &topics.get(3).unwrap());
    assert_eq!(voter, holder);

    let payload = VoteCastData::from_val(&env, &data);
    assert_eq!(payload.version, EVENT_SCHEMA_VERSION);
    assert_eq!(payload.vote, VoteOption::Approve);
    assert_eq!(payload.approve_votes, 1u32);
    assert_eq!(payload.reject_votes, 0u32);
}

#[test]
fn evt_clm_final_shape_on_majority() {
    let (env, client, _, _) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 50_000);
    seed(&client, &v2, 1_000_000, 50_000);
    seed(&client, &v3, 1_000_000, 50_000);
    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    client.vote_on_claim(&v2, &cid, &VoteOption::Approve); // majority → auto-finalize

    let (topics, data) = find_event(&env, "niffyins", "clm_final");

    // topics: (NS, "clm_final", claim_id: u64)
    assert_eq!(topics.len(), 3);
    let claim_id = u64::from_val(&env, &topics.get(2).unwrap());
    assert_eq!(claim_id, cid);

    let payload = ClaimFinalizedData::from_val(&env, &data);
    assert_eq!(payload.version, EVENT_SCHEMA_VERSION);
    assert_eq!(payload.status, ClaimStatus::Approved);
    assert_eq!(payload.approve_votes, 2u32);
    assert_eq!(payload.reject_votes, 0u32);
}

#[test]
fn evt_clm_final_shape_on_deadline() {
    use niffyinsure::types::VOTE_WINDOW_LEDGERS;
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 500_000);
    let cid = file(&client, &holder, 100_000, &env);
    env.ledger().with_mut(|l| l.sequence_number += VOTE_WINDOW_LEDGERS + 1);
    client.finalize_claim(&cid);

    let (topics, data) = find_event(&env, "niffyins", "clm_final");
    assert_eq!(topics.len(), 3);
    let payload = ClaimFinalizedData::from_val(&env, &data);
    assert_eq!(payload.version, EVENT_SCHEMA_VERSION);
    // No votes cast → tie → Rejected
    assert_eq!(payload.status, ClaimStatus::Rejected);
}

// ── Admin events ──────────────────────────────────────────────────────────────

#[test]
fn evt_adm_prop_shape() {
    let (env, client, admin, _) = setup();
    let new_admin = Address::generate(&env);
    client.propose_admin(&new_admin);

    let (topics, data) = find_event(&env, "niffyins", "adm_prop");
    // topics: (NS, "adm_prop", old_admin, new_admin)
    assert_eq!(topics.len(), 4);
    let old = Address::from_val(&env, &topics.get(2).unwrap());
    let proposed = Address::from_val(&env, &topics.get(3).unwrap());
    assert_eq!(old, admin);
    assert_eq!(proposed, new_admin);

    let payload = AdminProposedData::from_val(&env, &data);
    assert_eq!(payload.version, EVENT_SCHEMA_VERSION);
}

#[test]
fn evt_adm_acc_shape() {
    let (env, client, admin, _) = setup();
    let new_admin = Address::generate(&env);
    client.propose_admin(&new_admin);
    client.accept_admin();

    let (topics, data) = find_event(&env, "niffyins", "adm_acc");
    assert_eq!(topics.len(), 4);
    let old = Address::from_val(&env, &topics.get(2).unwrap());
    let accepted = Address::from_val(&env, &topics.get(3).unwrap());
    assert_eq!(old, admin);
    assert_eq!(accepted, new_admin);

    let payload = AdminAcceptedData::from_val(&env, &data);
    assert_eq!(payload.version, EVENT_SCHEMA_VERSION);
}

#[test]
fn evt_adm_can_shape() {
    let (env, client, admin, _) = setup();
    let new_admin = Address::generate(&env);
    client.propose_admin(&new_admin);
    client.cancel_admin();

    let (topics, data) = find_event(&env, "niffyins", "adm_can");
    assert_eq!(topics.len(), 4);
    let current = Address::from_val(&env, &topics.get(2).unwrap());
    let cancelled = Address::from_val(&env, &topics.get(3).unwrap());
    assert_eq!(current, admin);
    assert_eq!(cancelled, new_admin);

    let payload = AdminCancelledData::from_val(&env, &data);
    assert_eq!(payload.version, EVENT_SCHEMA_VERSION);
}

#[test]
fn evt_adm_tok_shape() {
    let (env, client, _, old_token) = setup();
    let new_token = Address::generate(&env);
    client.set_token(&new_token);

    let (topics, data) = find_event(&env, "niffyins", "adm_tok");
    // topics: (NS, "adm_tok")
    assert_eq!(topics.len(), 2);

    let payload = TokenUpdatedData::from_val(&env, &data);
    assert_eq!(payload.version, EVENT_SCHEMA_VERSION);
    assert_eq!(payload.old_token, old_token);
    assert_eq!(payload.new_token, new_token);
}

#[test]
fn evt_adm_paus_shape_pause() {
    let (env, client, admin, _) = setup();
    client.pause();

    let (topics, data) = find_event(&env, "niffyins", "adm_paus");
    // topics: (NS, "adm_paus", admin)
    assert_eq!(topics.len(), 3);
    let emitted_admin = Address::from_val(&env, &topics.get(2).unwrap());
    assert_eq!(emitted_admin, admin);

    let payload = PauseToggledData::from_val(&env, &data);
    assert_eq!(payload.version, EVENT_SCHEMA_VERSION);
    assert_eq!(payload.paused, 1u32);
}

#[test]
fn evt_adm_paus_shape_unpause() {
    let (env, client, _, _) = setup();
    client.pause();
    client.unpause();

    let (topics, data) = find_event(&env, "niffyins", "adm_paus");
    let payload = PauseToggledData::from_val(&env, &data);
    assert_eq!(payload.paused, 0u32);
    let _ = topics;
}

#[test]
fn evt_tbl_upd_shape() {
    let (env, client, _, _) = setup();
    let table = client.get_multiplier_table();
    // Bump version to trigger an update event.
    let mut new_table = table.clone();
    new_table.version = table.version + 1;
    client.update_multiplier_table(&new_table);

    let (topics, data) = find_event(&env, "niffyins", "tbl_upd");
    // topics: (NS, "tbl_upd")
    assert_eq!(topics.len(), 2);

    let payload = PremiumTableUpdatedData::from_val(&env, &data);
    assert_eq!(payload.version, EVENT_SCHEMA_VERSION);
    assert_eq!(payload.table_version, new_table.version);
}

#[test]
fn evt_asset_set_shape() {
    let (env, client, _, _) = setup();
    let asset = Address::generate(&env);
    client.set_allowed_asset(&asset, &true);

    let (topics, data) = find_event(&env, "niffyins", "asset_set");
    // topics: (NS, "asset_set", asset)
    assert_eq!(topics.len(), 3);
    let emitted_asset = Address::from_val(&env, &topics.get(2).unwrap());
    assert_eq!(emitted_asset, asset);

    let payload = AssetAllowlistedData::from_val(&env, &data);
    assert_eq!(payload.version, EVENT_SCHEMA_VERSION);
    assert_eq!(payload.allowed, 1u32);

    // Removal
    client.set_allowed_asset(&asset, &false);
    let (_, data2) = find_event(&env, "niffyins", "asset_set");
    let payload2 = AssetAllowlistedData::from_val(&env, &data2);
    assert_eq!(payload2.allowed, 0u32);
}
