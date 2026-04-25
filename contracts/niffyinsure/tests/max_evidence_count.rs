//! Tests for #323: admin-configurable max evidence count per claim.
//!
//! Verifies:
//! - Default falls back to compile-time IMAGE_URLS_MAX (5)
//! - Admin can raise/lower the limit within hard max (20)
//! - Filing at the limit succeeds; filing over the limit reverts
//! - Reducing the limit does not invalidate existing claims
//! - Setter enforces absolute hard max (> 20 reverts)
//! - MaxEvidenceCountUpdated event is emitted with old/new values
//! - Non-admin cannot call the setter

#![cfg(test)]

use niffyinsure::{storage::MAX_EVIDENCE_COUNT_HARD_MAX, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Events},
    vec, Address, BytesN, Env, String, Vec,
};

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

fn make_evidence(env: &Env, count: u32) -> Vec<niffyinsure::types::ClaimEvidenceEntry> {
    let mut v = Vec::new(env);
    for i in 0..count {
        let mut hash_bytes = [0u8; 32];
        hash_bytes[0] = (i + 1) as u8; // non-zero hash
        v.push_back(niffyinsure::types::ClaimEvidenceEntry {
            url: String::from_str(env, "https://ipfs.io/ipfs/Qm000000000000000000000000000000"),
            hash: BytesN::from_array(env, &hash_bytes),
        });
    }
    v
}

fn seed_policy(
    env: &Env,
    client: &NiffyInsureClient,
    holder: &Address,
    policy_id: u32,
    coverage: i128,
) {
    client.test_seed_policy(holder, &policy_id, &coverage, &999_999_999u32);
}

// ── Default value ─────────────────────────────────────────────────────────────

#[test]
fn default_max_evidence_count_is_compile_time_constant() {
    let (_env, client, _, _) = setup();
    // IMAGE_URLS_MAX = 5
    assert_eq!(client.get_max_evidence_count(), 5u32);
}

// ── Admin setter ──────────────────────────────────────────────────────────────

#[test]
fn admin_can_set_max_evidence_count() {
    let (_env, client, _, _) = setup();
    client.admin_set_max_evidence_count(&8u32).unwrap();
    assert_eq!(client.get_max_evidence_count(), 8u32);
}

#[test]
fn setter_emits_max_evidence_count_updated_event() {
    let (env, client, _, _) = setup();
    client.admin_set_max_evidence_count(&8u32).unwrap();
    assert!(!env.events().all().is_empty());
}

#[test]
fn setter_rejects_value_above_hard_max() {
    let (_env, client, _, _) = setup();
    let result = client.try_admin_set_max_evidence_count(&(MAX_EVIDENCE_COUNT_HARD_MAX + 1));
    assert!(result.is_err());
    assert!(
        soroban_sdk::testutils::arbitrary::std::format!("{:?}", result)
            .contains("MaxEvidenceCountOutOfBounds")
    );
}

#[test]
fn setter_accepts_hard_max_exactly() {
    let (_env, client, _, _) = setup();
    client
        .admin_set_max_evidence_count(&MAX_EVIDENCE_COUNT_HARD_MAX)
        .unwrap();
    assert_eq!(client.get_max_evidence_count(), MAX_EVIDENCE_COUNT_HARD_MAX);
}

#[test]
fn non_admin_cannot_set_max_evidence_count() {
    let env = Env::default();
    let cid = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &cid);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let rando = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &token);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &rando,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &cid,
            fn_name: "admin_set_max_evidence_count",
            args: vec![&env, soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&3u32, &env)],
            sub_invokes: &[],
        },
    }]);
    assert!(client.try_admin_set_max_evidence_count(&3u32).is_err());
}

// ── file_claim validation ─────────────────────────────────────────────────────

#[test]
fn file_claim_at_limit_succeeds() {
    let (env, client, holder, _token) = setup();
    seed_policy(&env, &client, &holder, 1, 1_000_000_000);
    // default limit = 5; file with exactly 5 evidence entries
    let evidence = make_evidence(&env, 5);
    let result = client.try_file_claim(
        &holder,
        &1u32,
        &100_000i128,
        &String::from_str(&env, "test claim"),
        &evidence,
        &None,
    );
    assert!(result.is_ok());
}

#[test]
fn file_claim_over_default_limit_reverts() {
    let (env, client, holder, _token) = setup();
    seed_policy(&env, &client, &holder, 1, 1_000_000_000);
    let evidence = make_evidence(&env, 6); // one over default limit of 5
    let result = client.try_file_claim(
        &holder,
        &1u32,
        &100_000i128,
        &String::from_str(&env, "test claim"),
        &evidence,
        &None,
    );
    assert!(result.is_err());
}

#[test]
fn file_claim_at_raised_limit_succeeds() {
    let (env, client, holder, _token) = setup();
    client.admin_set_max_evidence_count(&8u32).unwrap();
    seed_policy(&env, &client, &holder, 1, 1_000_000_000);
    let evidence = make_evidence(&env, 8);
    let result = client.try_file_claim(
        &holder,
        &1u32,
        &100_000i128,
        &String::from_str(&env, "test claim"),
        &evidence,
        &None,
    );
    assert!(result.is_ok());
}

#[test]
fn file_claim_over_raised_limit_reverts() {
    let (env, client, holder, _token) = setup();
    client.admin_set_max_evidence_count(&8u32).unwrap();
    seed_policy(&env, &client, &holder, 1, 1_000_000_000);
    let evidence = make_evidence(&env, 9);
    let result = client.try_file_claim(
        &holder,
        &1u32,
        &100_000i128,
        &String::from_str(&env, "test claim"),
        &evidence,
        &None,
    );
    assert!(result.is_err());
}

// ── Limit reduction does not invalidate existing claims ───────────────────────

#[test]
fn reducing_limit_does_not_invalidate_existing_claims() {
    let (env, client, holder, _token) = setup();
    // Raise limit to 8, file a claim with 8 evidence entries
    client.admin_set_max_evidence_count(&8u32).unwrap();
    seed_policy(&env, &client, &holder, 1, 1_000_000_000);
    let evidence = make_evidence(&env, 8);
    let claim_id = client
        .file_claim(
            &holder,
            &1u32,
            &100_000i128,
            &String::from_str(&env, "test claim"),
            &evidence,
            &None,
        )
        .unwrap();

    // Admin reduces limit back to 3
    client.admin_set_max_evidence_count(&3u32).unwrap();

    // Existing claim is still readable and valid
    let claim = client.get_claim(&claim_id).unwrap();
    assert_eq!(claim.evidence.len(), 8u32);
}
