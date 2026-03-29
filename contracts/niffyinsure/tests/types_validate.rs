#![cfg(test)]

use niffyinsure::{
    types::{
        Claim, ClaimEvidenceEntry, ClaimStatus, Policy, PolicyType, RegionTier, TerminationReason,
        VoteOption, DETAILS_MAX_LEN, IMAGE_URLS_MAX, IMAGE_URL_MAX_LEN,
    },
    validate::{check_claim_fields, check_claim_open, check_policy, check_policy_active, Error},
};
use soroban_sdk::{testutils::Address as _, BytesN, Address, Env, String, Vec};

fn non_zero_hash(env: &Env) -> BytesN<32> {
    let mut a = [0u8; 32];
    a[0] = 1;
    BytesN::from_array(env, &a)
}

fn zero_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn empty_evidence(env: &Env) -> Vec<ClaimEvidenceEntry> {
    Vec::new(env)
}

fn one_url_evidence(env: &Env, url: &str) -> Vec<ClaimEvidenceEntry> {
    let mut v = Vec::new(env);
    v.push_back(ClaimEvidenceEntry {
        url: String::from_str(env, url),
        hash: non_zero_hash(env),
    });
    v
}

fn dummy_policy(env: &Env, start: u32, end: u32, coverage: i128, active: bool) -> Policy {
    Policy {
        holder: Address::generate(env),
        policy_id: 1,
        policy_type: PolicyType::Auto,
        region: RegionTier::Medium,
        premium: 10_000_000,
        coverage,
        is_active: active,
        start_ledger: start,
        end_ledger: end,
        asset: Address::generate(env),
        deductible: None,
        beneficiary: None,
        terminated_at_ledger: 0,
        termination_reason: TerminationReason::None,
        terminated_by_admin: false,
        strike_count: 0,
    }
}

fn dummy_claim(env: &Env, amount: i128, status: ClaimStatus) -> Claim {
    Claim {
        claim_id: 1,
        policy_id: 1,
        claimant: Address::generate(env),
        amount,
        deductible: 0,
        asset: Address::generate(env),
        details: String::from_str(env, "fire damage"),
        evidence: empty_evidence(env),
        status,
        voting_deadline_ledger: 1_000,
        approve_votes: 0,
        reject_votes: 0,
        filed_at: 100,
        appeal_open_deadline_ledger: 0,
        appeals_count: 0,
        appeal_deadline_ledger: 0,
        appeal_approve_votes: 0,
        appeal_reject_votes: 0,
        status_history: soroban_sdk::Vec::new(env),
    }
}

// ── Policy struct validation ──────────────────────────────────────────────────

#[test]
fn valid_policy_passes() {
    let env = Env::default();
    let p = dummy_policy(&env, 100, 200, 50_000_000, true);
    assert_eq!(check_policy(&p), Ok(()));
}

#[test]
fn zero_coverage_rejected() {
    let env = Env::default();
    let p = dummy_policy(&env, 100, 200, 0, true);
    assert_eq!(check_policy(&p), Err(Error::ZeroCoverage));
}

#[test]
fn negative_coverage_rejected() {
    let env = Env::default();
    let p = dummy_policy(&env, 100, 200, -1, true);
    assert_eq!(check_policy(&p), Err(Error::ZeroCoverage));
}

#[test]
fn inverted_ledger_window_rejected() {
    let env = Env::default();
    let p = dummy_policy(&env, 200, 100, 50_000_000, true);
    assert_eq!(check_policy(&p), Err(Error::InvalidLedgerWindow));
}

#[test]
fn equal_ledger_window_rejected() {
    let env = Env::default();
    let p = dummy_policy(&env, 100, 100, 50_000_000, true);
    assert_eq!(check_policy(&p), Err(Error::InvalidLedgerWindow));
}

#[test]
fn deductible_within_coverage_passes() {
    let env = Env::default();
    let mut p = dummy_policy(&env, 100, 200, 50_000_000, true);
    p.deductible = Some(10_000_000);
    assert_eq!(check_policy(&p), Ok(()));
}

#[test]
fn deductible_exceeding_coverage_rejected() {
    let env = Env::default();
    let mut p = dummy_policy(&env, 100, 200, 50_000_000, true);
    p.deductible = Some(50_000_001);
    assert_eq!(check_policy(&p), Err(Error::Overflow));
}

#[test]
fn negative_deductible_rejected() {
    let env = Env::default();
    let mut p = dummy_policy(&env, 100, 200, 50_000_000, true);
    p.deductible = Some(-1);
    assert_eq!(check_policy(&p), Err(Error::Overflow));
}

// ── Policy active check ───────────────────────────────────────────────────────

#[test]
fn active_policy_within_window_passes() {
    let env = Env::default();
    let p = dummy_policy(&env, 100, 200, 50_000_000, true);
    assert_eq!(check_policy_active(&p, 150), Ok(()));
}

#[test]
fn expired_policy_rejected() {
    let env = Env::default();
    let p = dummy_policy(&env, 100, 200, 50_000_000, true);
    assert_eq!(check_policy_active(&p, 200), Err(Error::PolicyExpired));
    assert_eq!(check_policy_active(&p, 201), Err(Error::PolicyExpired));
}

#[test]
fn inactive_policy_rejected() {
    let env = Env::default();
    let p = dummy_policy(&env, 100, 200, 50_000_000, false);
    assert_eq!(check_policy_active(&p, 150), Err(Error::PolicyInactive));
}

// ── Claim field validation ────────────────────────────────────────────────────

#[test]
fn valid_claim_passes() {
    let env = Env::default();
    let details = String::from_str(&env, "roof collapsed");
    let ev = one_url_evidence(&env, "ipfs://Qm123");
    assert_eq!(
        check_claim_fields(&env, 1_000_000, 50_000_000, &details, &ev),
        Ok(())
    );
}

#[test]
fn zero_claim_amount_rejected() {
    let env = Env::default();
    let details = String::from_str(&env, "x");
    let ev = empty_evidence(&env);
    assert_eq!(
        check_claim_fields(&env, 0, 50_000_000, &details, &ev),
        Err(Error::ClaimAmountZero)
    );
}

#[test]
fn claim_exceeds_coverage_rejected() {
    let env = Env::default();
    let details = String::from_str(&env, "x");
    let ev = empty_evidence(&env);
    assert_eq!(
        check_claim_fields(&env, 60_000_000, 50_000_000, &details, &ev),
        Err(Error::ClaimExceedsCoverage)
    );
}

#[test]
fn claim_amount_equal_to_coverage_passes() {
    let env = Env::default();
    let details = String::from_str(&env, "x");
    let ev = empty_evidence(&env);
    assert_eq!(
        check_claim_fields(&env, 50_000_000, 50_000_000, &details, &ev),
        Ok(())
    );
}

#[test]
fn details_at_max_len_passes() {
    let env = Env::default();
    let s: soroban_sdk::String = String::from_str(&env, &"a".repeat(DETAILS_MAX_LEN as usize));
    let ev = empty_evidence(&env);
    assert_eq!(check_claim_fields(&env, 1, 100, &s, &ev), Ok(()));
}

#[test]
fn details_over_max_len_rejected() {
    let env = Env::default();
    let s = String::from_str(&env, &"a".repeat(DETAILS_MAX_LEN as usize + 1));
    let ev = empty_evidence(&env);
    assert_eq!(
        check_claim_fields(&env, 1, 100, &s, &ev),
        Err(Error::DetailsTooLong)
    );
}

#[test]
fn too_many_image_urls_rejected() {
    let env = Env::default();
    let details = String::from_str(&env, "x");
    let url = String::from_str(&env, "ipfs://Qm1");
    let mut ev = Vec::new(&env);
    for _ in 0..=IMAGE_URLS_MAX {
        ev.push_back(ClaimEvidenceEntry {
            url: url.clone(),
            hash: non_zero_hash(&env),
        });
    }
    assert_eq!(
        check_claim_fields(&env, 1, 100, &details, &ev),
        Err(Error::TooManyImageUrls)
    );
}

#[test]
fn image_url_over_max_len_rejected() {
    let env = Env::default();
    let details = String::from_str(&env, "x");
    let long_url = String::from_str(&env, &"u".repeat(IMAGE_URL_MAX_LEN as usize + 1));
    let mut ev = Vec::new(&env);
    ev.push_back(ClaimEvidenceEntry {
        url: long_url,
        hash: non_zero_hash(&env),
    });
    assert_eq!(
        check_claim_fields(&env, 1, 100, &details, &ev),
        Err(Error::ImageUrlTooLong)
    );
}

#[test]
fn evidence_sha256_all_zero_rejected() {
    let env = Env::default();
    let details = String::from_str(&env, "x");
    let mut ev = Vec::new(&env);
    ev.push_back(ClaimEvidenceEntry {
        url: String::from_str(&env, "ipfs://a"),
        hash: zero_hash(&env),
    });
    assert_eq!(
        check_claim_fields(&env, 1, 100, &details, &ev),
        Err(Error::ExcessiveEvidenceBytes)
    );
}

// ── Claim status / vote validation ───────────────────────────────────────────

#[test]
fn processing_claim_is_open() {
    let env = Env::default();
    let c = dummy_claim(&env, 1_000_000, ClaimStatus::Processing);
    assert_eq!(check_claim_open(&c), Ok(()));
}

#[test]
fn approved_claim_is_terminal() {
    let env = Env::default();
    let c = dummy_claim(&env, 1_000_000, ClaimStatus::Approved);
    assert_eq!(check_claim_open(&c), Err(Error::ClaimAlreadyTerminal));
}

#[test]
fn paid_claim_is_terminal() {
    let env = Env::default();
    let c = dummy_claim(&env, 1_000_000, ClaimStatus::Paid);
    assert_eq!(check_claim_open(&c), Err(Error::ClaimAlreadyTerminal));
}

#[test]
fn rejected_claim_is_terminal() {
    let env = Env::default();
    let c = dummy_claim(&env, 1_000_000, ClaimStatus::Rejected);
    assert_eq!(check_claim_open(&c), Err(Error::ClaimAlreadyTerminal));
}

// ── Enum coherence ────────────────────────────────────────────────────────────

#[test]
fn vote_option_variants_distinct() {
    assert_ne!(VoteOption::Approve, VoteOption::Reject);
}

#[test]
fn claim_status_terminal_flags() {
    assert!(!ClaimStatus::Pending.is_terminal());
    assert!(!ClaimStatus::Processing.is_terminal());
    assert!(ClaimStatus::Approved.is_terminal());
    assert!(ClaimStatus::Paid.is_terminal());
    assert!(ClaimStatus::Rejected.is_terminal());
}
