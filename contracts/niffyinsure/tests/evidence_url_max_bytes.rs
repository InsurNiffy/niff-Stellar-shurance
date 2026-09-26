//! Evidence URL length cap: `MAX_EVIDENCE_URL_BYTES` (types.rs) is enforced
//! per-entry at `file_claim` time. Over-limit URLs revert with
//! `EvidenceUrlTooLong`; every entry in the array is checked, not just the
//! first.

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{ClaimEvidenceEntry, MAX_EVIDENCE_URL_BYTES},
    validate::Error as ValidateError,
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String, Vec,
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

fn seed(client: &NiffyInsureClient, holder: &Address) {
    client.test_seed_policy(holder, &1u32, &1_000_000i128, &500_000u32);
}

/// Build an `ipfs://` URL (passes format validation) of exactly `len` bytes.
fn ipfs_url_of_len(env: &Env, len: usize) -> String {
    let prefix = "ipfs://";
    assert!(len >= prefix.len(), "len must fit the ipfs:// prefix");
    let mut s = std::string::String::from(prefix);
    for _ in 0..(len - prefix.len()) {
        s.push('a');
    }
    String::from_str(env, &s)
}

fn evidence_with_url(env: &Env, url: String) -> Vec<ClaimEvidenceEntry> {
    let mut v = Vec::new(env);
    v.push_back(ClaimEvidenceEntry {
        url,
        hash: common::non_zero_hash(env),
    });
    v
}

#[test]
fn url_at_exact_limit_is_accepted() {
    let (env, client, _admin, _token) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder);

    let url = ipfs_url_of_len(&env, MAX_EVIDENCE_URL_BYTES as usize);
    let evidence = evidence_with_url(&env, url);
    let details = String::from_str(&env, "at-limit evidence url");

    let claim_id = client.file_claim(&holder, &1u32, &10_000i128, &details, &evidence, &None);
    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.evidence.len(), 1);
}

#[test]
fn url_one_byte_over_limit_reverts() {
    let (env, client, _admin, _token) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder);

    let url = ipfs_url_of_len(&env, MAX_EVIDENCE_URL_BYTES as usize + 1);
    let evidence = evidence_with_url(&env, url);
    let details = String::from_str(&env, "over-limit evidence url");

    let r = client.try_file_claim(&holder, &1u32, &10_000i128, &details, &evidence, &None);
    assert_eq!(r.unwrap_err().unwrap(), ValidateError::EvidenceUrlTooLong);
}

#[test]
fn multi_url_batch_with_one_over_limit_entry_reverts() {
    let (env, client, _admin, _token) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder);

    // First two entries are within the limit; the third (not the first) is
    // over-limit — proves every entry is checked, not just entry 0.
    let mut evidence: Vec<ClaimEvidenceEntry> = Vec::new(&env);
    evidence.push_back(ClaimEvidenceEntry {
        url: ipfs_url_of_len(&env, 20),
        hash: common::non_zero_hash(&env),
    });
    evidence.push_back(ClaimEvidenceEntry {
        url: ipfs_url_of_len(&env, MAX_EVIDENCE_URL_BYTES as usize),
        hash: common::non_zero_hash(&env),
    });
    evidence.push_back(ClaimEvidenceEntry {
        url: ipfs_url_of_len(&env, MAX_EVIDENCE_URL_BYTES as usize + 50),
        hash: common::non_zero_hash(&env),
    });

    let details = String::from_str(&env, "multi-url batch with one over-limit entry");
    let r = client.try_file_claim(&holder, &1u32, &10_000i128, &details, &evidence, &None);
    assert_eq!(r.unwrap_err().unwrap(), ValidateError::EvidenceUrlTooLong);
}
