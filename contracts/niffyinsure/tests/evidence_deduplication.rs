#![cfg(test)]

use niffyinsure::NiffyInsureClient;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, String, Vec,
};

mod common;
use common::{non_zero_hash, sample_digest};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    // test_seed_policy uses start_ledger=1; advance so now >= start_ledger.
    env.ledger().set_sequence_number(1);
    (env, client, admin, token)
}

#[test]
fn unique_evidence_entries_accepted() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &999_999u32);

    let mut evidence = Vec::new(&env);
    evidence.push_back(niffyinsure::types::ClaimEvidenceEntry {
        url: String::from_str(&env, "ipfs://hash1"),
        hash: non_zero_hash(&env),
    });
    evidence.push_back(niffyinsure::types::ClaimEvidenceEntry {
        url: String::from_str(&env, "ipfs://hash2"),
        hash: sample_digest(&env),
    });

    let result = client
        .try_file_claim(
            &holder,
            &1u32,
            &100_000i128,
            &String::from_str(&env, "test claim"),
            &evidence,
            &None,
        )
        .unwrap();
    assert!(result.is_ok());
}

#[test]
fn duplicate_url_and_hash_reverts_with_duplicate_evidence() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &999_999u32);

    let entry = niffyinsure::types::ClaimEvidenceEntry {
        url: String::from_str(&env, "ipfs://samehash"),
        hash: non_zero_hash(&env),
    };
    let mut evidence = Vec::new(&env);
    evidence.push_back(entry.clone());
    evidence.push_back(entry);

    let result = client.try_file_claim(
        &holder,
        &1u32,
        &100_000i128,
        &String::from_str(&env, "test claim"),
        &evidence,
        &None,
    );
    assert!(result.is_err(), "duplicate evidence must be rejected");
}

#[test]
fn all_duplicate_entries_revert() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &999_999u32);

    let entry = niffyinsure::types::ClaimEvidenceEntry {
        url: String::from_str(&env, "ipfs://samehash"),
        hash: non_zero_hash(&env),
    };
    let mut evidence = Vec::new(&env);
    evidence.push_back(entry.clone());
    evidence.push_back(entry.clone());
    evidence.push_back(entry);

    let result = client.try_file_claim(
        &holder,
        &1u32,
        &100_000i128,
        &String::from_str(&env, "test claim"),
        &evidence,
        &None,
    );
    assert!(result.is_err(), "all-duplicate evidence must be rejected");
}

#[test]
fn same_url_different_hash_is_allowed() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &999_999u32);

    let mut hash_a = [0u8; 32];
    hash_a[0] = 1;
    let mut hash_b = [0u8; 32];
    hash_b[0] = 2;

    let mut evidence = Vec::new(&env);
    evidence.push_back(niffyinsure::types::ClaimEvidenceEntry {
        url: String::from_str(&env, "ipfs://same-url"),
        hash: BytesN::from_array(&env, &hash_a),
    });
    evidence.push_back(niffyinsure::types::ClaimEvidenceEntry {
        url: String::from_str(&env, "ipfs://same-url"),
        hash: BytesN::from_array(&env, &hash_b),
    });

    let result = client
        .try_file_claim(
            &holder,
            &1u32,
            &100_000i128,
            &String::from_str(&env, "test claim"),
            &evidence,
            &None,
        )
        .unwrap();
    assert!(result.is_ok());
}
