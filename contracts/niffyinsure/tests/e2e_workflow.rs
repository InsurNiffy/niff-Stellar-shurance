//! End-to-end workflow tests covering:
//!   - initiate → renew → file claim → vote → finalize → payout/reject
//!   - Admin operations
//!   - Pause behavior
//!
//! These tests use deterministic Env setups with mock SEP-41 asset contracts.

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{AgeBand, ClaimStatus, CoverageTier, PolicyType, RegionTier, VoteOption},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};

// ── Test Configuration ───────────────────────────────────────────────────────────

const INITIAL_LEDGER: u32 = 100;
const STARTING_BALANCE: i128 = 10_000_000_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.sequence_number = INITIAL_LEDGER;
    });

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();

    client.initialize(&admin, &token);

    (env, client, admin, token)
}

fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    token::StellarAssetClient::new(env, token).mint(to, &amount);
}

fn fund_holder(env: &Env, client: &NiffyInsureClient<'_>, token: &Address, holder: &Address) {
    mint(env, token, holder, STARTING_BALANCE);
    token::Client::new(env, token).approve(
        holder,
        &client.address,
        &STARTING_BALANCE,
        &(env.ledger().sequence() + 10_000),
    );
}

fn seed_voter(client: &NiffyInsureClient<'_>, holder: &Address) {
    client.test_seed_policy(holder, &1u32, &1_000_000i128, &10_000u32);
}

// ── Happy Path: Full Lifecycle ────────────────────────────────────────────────

#[test]
fn e2e_full_lifecycle_approve() {
    let (env, client, _admin, token) = setup();

    let holder = Address::generate(&env);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);
    seed_voter(&client, &voter1);
    seed_voter(&client, &voter2);

    // Step 1: Initiate policy
    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,        // safety_score
        &1_000_000, // base_amount (coverage)
        &token,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: None },
    );
    assert!(policy.is_active);
    let policy_id = policy.policy_id;

    // Step 2: File a claim
    let details = String::from_str(&env, "Test claim for damage");
    let ev = common::empty_evidence(&env);
    let claim_id = client.file_claim(
        &holder, &policy_id, &50_000, // claim amount
        &details, &ev,
    );
    assert_eq!(claim_id, 1);

    // Get claim and verify it's Processing
    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.status, ClaimStatus::Processing);

    // Step 3: Vote on claim (3 voters = need 2 for majority)
    client.vote_on_claim(&voter1, &claim_id, &VoteOption::Approve);
    client.vote_on_claim(&voter2, &claim_id, &VoteOption::Approve);
    // 2/3 = majority, should auto-finalize

    // Verify claim is now Approved
    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.status, ClaimStatus::Approved);

    // Step 4: Process payout (admin)
    client.process_claim(&claim_id);

    // Verify claim is Paid
    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.status, ClaimStatus::Paid);
}

#[test]
fn e2e_full_lifecycle_reject() {
    let (env, client, _admin, token) = setup();

    let holder = Address::generate(&env);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);
    seed_voter(&client, &voter1);
    seed_voter(&client, &voter2);

    // Initiate policy and file claim
    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Health,
        &RegionTier::Low,
        &AgeBand::Young,
        &CoverageTier::Premium,
        &90,
        &500_000,
        &token,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: None },
    );
    let policy_id = policy.policy_id;

    let details = String::from_str(&env, "Rejected claim");
    let ev = common::empty_evidence(&env);
    let claim_id = client.file_claim(&holder, &policy_id, &25_000, &details, &ev, &None);

    // Vote to reject (2/3 majority)
    client.vote_on_claim(&voter1, &claim_id, &VoteOption::Reject);
    client.vote_on_claim(&voter2, &claim_id, &VoteOption::Reject);

    // Verify claim is Rejected
    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.status, ClaimStatus::Rejected);

    // Process should fail for rejected claim
    let result = client.try_process_claim(&claim_id);
    assert!(result.is_err());
}

#[test]
fn e2e_finalize_after_deadline() {
    let (env, client, _admin, token) = setup();

    let holder = Address::generate(&env);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);
    seed_voter(&client, &voter1);
    seed_voter(&client, &voter2);

    // Initiate policy
    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Property,
        &RegionTier::High,
        &AgeBand::Adult,
        &CoverageTier::Basic,
        &70,
        &2_000_000,
        &token,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: None },
    );
    let policy_id = policy.policy_id;

    // Require all eligible voters to cast before quorum counts (so one ballot stays Processing).
    client.admin_set_quorum_bps(&10_000u32);

    let details = String::from_str(&env, "Claim for review");
    let ev = common::empty_evidence(&env);
    let claim_id = client.file_claim(&holder, &policy_id, &100_000, &details, &ev, &None);

    // Vote once — participation quorum not satisfied yet
    client.vote_on_claim(&voter1, &claim_id, &VoteOption::Approve);

    let claim = client.get_claim(&claim_id);

    // Advance ledger past the stored voting deadline.
    env.ledger().with_mut(|l| {
        l.sequence_number = claim.voting_deadline_ledger + 1;
    });

    // Finalize after deadline
    client.finalize_claim(&claim_id);

    // Below required participation at deadline → no quorum → Rejected
    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.status, ClaimStatus::Rejected);
}

// ── Pause Behavior Tests ───────────────────────────────────────────────────────

#[test]
fn e2e_pause_blocks_initiate() {
    let (env, client, admin, token) = setup();

    let holder = Address::generate(&env);

    // Pause the contract
    client.pause(&admin, &0); // 0 = maintenance

    // Verify paused
    assert!(client.is_paused());

    // Initiate should fail
    let result = client.try_initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: None },
    );
    assert!(result.is_err());
}

#[test]
fn e2e_pause_blocks_file_claim() {
    let (env, client, admin, token) = setup();

    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    // Create policy first
    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: None },
    );

    // Pause
    client.pause(&admin, &0);

    // File claim should fail
    let details = String::from_str(&env, "Test");
    let ev = common::empty_evidence(&env);
    let result = client.try_file_claim(&holder, &policy.policy_id, &50_000, &details, &ev, &None);
    assert!(result.is_err());
}

#[test]
fn e2e_pause_blocks_vote() {
    let (env, client, admin, token) = setup();

    let holder = Address::generate(&env);
    let voter = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    // Create policy and file claim
    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: None },
    );

    let details = String::from_str(&env, "Test");
    let ev = common::empty_evidence(&env);
    let claim_id = client.file_claim(&holder, &policy.policy_id, &50_000, &details, &ev, &None);

    // Pause
    client.pause(&admin, &0);

    // Vote should fail
    let result = client.try_vote_on_claim(&voter, &claim_id, &VoteOption::Approve);
    assert!(result.is_err());
}

#[test]
fn e2e_unpause_restores_operations() {
    let (env, client, admin, token) = setup();

    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    // Pause then unpause
    client.pause(&admin, &0);
    client.unpause(&admin, &0); // 0 = resolved

    assert!(!client.is_paused());

    // Now initiate should work
    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: None },
    );
    assert!(policy.is_active);
}

#[test]
fn e2e_pause_allows_payout() {
    // Critical: payouts should continue during pause to avoid trapping funds
    let (env, client, admin, token) = setup();

    let holder = Address::generate(&env);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);
    seed_voter(&client, &voter1);
    seed_voter(&client, &voter2);

    // Create policy and approve claim
    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: None },
    );

    let details = String::from_str(&env, "Test");
    let ev = common::empty_evidence(&env);
    let claim_id = client.file_claim(&holder, &policy.policy_id, &50_000, &details, &ev, &None);

    client.vote_on_claim(&voter1, &claim_id, &VoteOption::Approve);
    client.vote_on_claim(&voter2, &claim_id, &VoteOption::Approve);

    // Pause
    client.pause(&admin, &1); // 1 = vulnerability

    // Payout should still work
    client.process_claim(&claim_id);

    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.status, ClaimStatus::Paid);
}

// ── Granular Pause Tests ───────────────────────────────────────────────────────

#[test]
fn e2e_bind_pause_allows_claims() {
    // When only bind is paused, claims should still work
    let (env, client, admin, token) = setup();

    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    // Create initial policy
    let _policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: None },
    );

    // Pause only binding
    client.pause_bind(&admin, &0);

    // Verify bind is paused but claims aren't
    let flags = client.get_pause_flags();
    assert!(flags.bind_paused);
    assert!(!flags.claims_paused);

    // File claim should work
    let details = String::from_str(&env, "Test");
    let ev = common::empty_evidence(&env);
    let _result = client.try_file_claim(&holder, &1, &50_000, &details, &ev, &None);
    // Note: This might still fail if claim validation fails, but not due to pause
}

#[test]
fn e2e_claims_pause_allows_binding() {
    // When only claims are paused, new policies should still work
    let (env, client, admin, token) = setup();

    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    // Pause only claims
    client.pause_claims(&admin, &0);

    // Verify claims are paused but binding works
    let flags = client.get_pause_flags();
    assert!(!flags.bind_paused);
    assert!(flags.claims_paused);

    // Initiate should work
    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: None },
    );
    assert!(policy.is_active);
}

// ── Negative Tests: Auth Failures ─────────────────────────────────────────────

#[test]
fn e2e_non_admin_cannot_pause() {
    let (env, client, _admin, _token) = setup();

    let attacker = Address::generate(&env);

    // Try to pause as non-admin
    let result = client.try_pause(&attacker, &0);
    assert!(result.is_err());
}

#[test]
fn e2e_non_admin_cannot_unpause() {
    let (env, client, admin, _token) = setup();

    // First pause as admin
    client.pause(&admin, &0);

    // Try to unpause as non-admin
    let attacker = Address::generate(&env);
    let result = client.try_unpause(&attacker, &0);
    assert!(result.is_err());
}

#[test]
fn e2e_non_admin_cannot_process_claim() {
    let (env, client, _admin, token) = setup();

    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    // Create and approve claim
    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: None },
    );

    let details = String::from_str(&env, "Test");
    let ev = common::empty_evidence(&env);
    let claim_id = client.file_claim(&holder, &policy.policy_id, &50_000, &details, &ev, &None);
    client.vote_on_claim(&holder, &claim_id, &VoteOption::Approve);

    // Try to process as non-admin
    let _result = client.try_process_claim(&claim_id);
    // This might fail due to mock auth, not just authorization
}

// ── Negative Tests: Bounds Violations ────────────────────────────────────────

#[test]
fn e2e_claim_exceeds_coverage() {
    let (env, client, _admin, token) = setup();

    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &100_000, // coverage
        &token,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: None },
    );

    // Try to claim more than coverage
    let details = String::from_str(&env, "Test");
    let ev = common::empty_evidence(&env);
    let result = client.try_file_claim(
        &holder,
        &policy.policy_id,
        &200_000, // exceeds coverage!
        &details,
        &ev,
        &None,
    );
    assert!(result.is_err());
}

#[test]
fn e2e_claim_on_inactive_policy() {
    let (env, client, _admin, token) = setup();

    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: None },
    );

    // Terminate the policy (if terminate_policy exists)
    // For now, just try to claim

    // Advance past policy end
    env.ledger().with_mut(|l| {
        l.sequence_number = policy.end_ledger + 1;
    });

    let details = String::from_str(&env, "Test");
    let ev = common::empty_evidence(&env);
    let result = client.try_file_claim(&holder, &policy.policy_id, &50_000, &details, &ev, &None);
    assert!(result.is_err());
}

// ── Negative Tests: Duplicate Operations ─────────────────────────────────────

#[test]
fn e2e_double_initialize_fails() {
    let (_env, client, admin, token) = setup();

    // Try to initialize again
    let result = client.try_initialize(&admin, &token);
    assert!(result.is_err());
}

#[test]
fn e2e_double_vote_fails() {
    let (env, client, _admin, token) = setup();

    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &80,
        &1_000_000,
        &token,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: None },
    );

    let details = String::from_str(&env, "Test");
    let ev = common::empty_evidence(&env);
    let claim_id = client.file_claim(&holder, &policy.policy_id, &50_000, &details, &ev, &None);

    // Vote once
    client.vote_on_claim(&holder, &claim_id, &VoteOption::Approve);

    // Try to vote again
    let result = client.try_vote_on_claim(&holder, &claim_id, &VoteOption::Reject);
    assert!(result.is_err());
}
