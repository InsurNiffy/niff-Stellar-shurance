//! Asserts the canonical event topic layout documented in docs/events.md:
//!
//!   [contract_name, event_name, entity_id?, actor?]
//!
//! Each test files/drives a real contract action and checks that the
//! contract-name symbol and event-name symbol appear, in order, in the
//! emitted event's topic vector.

#![cfg(test)]

mod common;

use niffyinsure::{types::VoteOption, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, Env, String,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

fn seed(client: &NiffyInsureClient, holder: &Address, coverage: i128, end_ledger: u32) {
    client.test_seed_policy(holder, &1u32, &coverage, &end_ledger);
}

/// Returns the topics debug string for the most recent event whose topics
/// contain `event_name`.
fn topics_for(env: &Env, event_name: &str) -> String {
    let all = env.events().all();
    for event in all.events() {
        let s = soroban_sdk::testutils::arbitrary::std::format!("{:?}", event.body);
        if s.contains(event_name) {
            return String::from_str(env, &s);
        }
    }
    panic!("event '{}' not found in event log", event_name);
}

fn assert_contract_before_event(env: &Env, event_name: &str) {
    let topics = topics_for(env, event_name);
    let s = topics.to_string();
    let contract_pos = s.find("niffyinsure").expect("contract_name topic missing");
    let event_pos = s.find(event_name).expect("event_name topic missing");
    assert!(
        contract_pos < event_pos,
        "expected contract_name topic before event_name topic for '{}': {}",
        event_name,
        s
    );
}

#[test]
fn claim_filed_topic_layout() {
    let (env, client, _admin, _token) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 50_000);

    let details = String::from_str(&env, "topic layout test");
    let ev = common::empty_evidence(&env);
    let _cid = client.file_claim(&holder, &1u32, &100_000i128, &details, &ev, &None);

    assert_contract_before_event(&env, "claim_filed");
}

#[test]
fn claim_rejected_topic_layout() {
    let (env, client, _admin, _token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);

    let details = String::from_str(&env, "topic layout test");
    let ev = common::empty_evidence(&env);
    let cid = client.file_claim(&v1, &1u32, &100_000i128, &details, &ev, &None);

    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);

    assert_contract_before_event(&env, "claim_rejected");
}

#[test]
fn strike_incremented_topic_layout() {
    let (env, client, _admin, _token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);

    let details = String::from_str(&env, "topic layout test");
    let ev = common::empty_evidence(&env);
    let cid = client.file_claim(&v1, &1u32, &100_000i128, &details, &ev, &None);

    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);

    assert_contract_before_event(&env, "strike_incremented");
}
