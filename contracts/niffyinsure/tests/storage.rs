//! Integration tests for storage.rs typed accessors.
//!
//! All persistence goes exclusively through the storage module helpers —
//! no raw env.storage() calls, no hand-rolled DataKey construction.
//!
//! Keyspace coverage:
//!   Instance  : Admin, Token, Paused, ClaimCounter, Voters
//!   Persistent: PolicyCounter, Policy, Claim, Vote

#![cfg(test)]

use niffyinsure::{
    storage,
    types::{ClaimStatus, Policy, PolicyType, RegionTier, VoteOption},
    NiffyInsureClient,
};
use soroban_sdk::{testutils::Address as _, vec, Address, Env, String};

// ── helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let client = NiffyInsureClient::new(&env, &contract_id);
    client.initialize(&admin, &token);
    (env, contract_id, admin, token)
}

fn make_policy(holder: &Address, policy_id: u32) -> Policy {
    Policy {
        holder: holder.clone(),
        policy_id,
        policy_type: PolicyType::Auto,
        region: RegionTier::Medium,
        premium: 10_000_000,
        coverage: 100_000_000,
        is_active: true,
        start_ledger: 0,
        end_ledger: 9_999_999,
    }
}

// ── instance-tier: counters and flags ────────────────────────────────────────

#[test]
fn claim_counter_starts_at_zero() {
    let (env, contract_id, _, _) = setup();
    let client = NiffyInsureClient::new(&env, &contract_id);
    assert_eq!(client.get_claim_counter(), 0u64);
}

#[test]
fn policy_counter_starts_at_zero_for_new_holder() {
    let (env, contract_id, _, _) = setup();
    let client = NiffyInsureClient::new(&env, &contract_id);
    let holder = Address::generate(&env);
    assert_eq!(client.get_policy_counter(&holder), 0u32);
}

#[test]
fn has_policy_false_for_nonexistent() {
    let (env, contract_id, _, _) = setup();
    let client = NiffyInsureClient::new(&env, &contract_id);
    let holder = Address::generate(&env);
    assert!(!client.has_policy(&holder, &1u32));
}

#[test]
fn voter_list_starts_empty() {
    let (env, contract_id, _, _) = setup();
    let client = NiffyInsureClient::new(&env, &contract_id);
    assert_eq!(client.get_voters().len(), 0u32);
}

#[test]
fn contract_starts_unpaused() {
    let (env, contract_id, _, _) = setup();
    let client = NiffyInsureClient::new(&env, &contract_id);
    assert!(!client.is_paused());
}

// ── persistent-tier: policy read/write via helpers ───────────────────────────

#[test]
fn set_and_get_policy_round_trip() {
    let (env, contract_id, _, _) = setup();
    let holder = Address::generate(&env);
    let policy = make_policy(&holder, 1);

    env.as_contract(&contract_id, || {
        storage::set_policy(&env, &policy);
        let loaded = storage::get_policy(&env, &holder, 1).expect("policy must exist");
        assert_eq!(loaded.policy_id, 1);
        assert_eq!(loaded.coverage, 100_000_000);
        assert!(loaded.is_active);
    });

    // has_policy visible through contract client too
    let client = NiffyInsureClient::new(&env, &contract_id);
    assert!(client.has_policy(&holder, &1u32));
}

#[test]
fn get_policy_returns_none_when_absent() {
    let (env, contract_id, _, _) = setup();
    let holder = Address::generate(&env);
    env.as_contract(&contract_id, || {
        assert!(storage::get_policy(&env, &holder, 99).is_none());
    });
}

// ── persistent-tier: voter list helpers ──────────────────────────────────────

#[test]
fn add_voter_and_remove_voter() {
    let (env, contract_id, _, _) = setup();
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::add_voter(&env, &a);
        storage::add_voter(&env, &b);
        assert_eq!(storage::get_voters(&env).len(), 2u32);

        // idempotent add
        storage::add_voter(&env, &a);
        assert_eq!(storage::get_voters(&env).len(), 2u32);

        storage::remove_voter(&env, &a);
        let voters = storage::get_voters(&env);
        assert_eq!(voters.len(), 1u32);
        assert_eq!(voters.get(0).unwrap(), b);
    });
}

// ── persistent-tier: claim read/write ────────────────────────────────────────

#[test]
fn set_and_get_claim_round_trip() {
    let (env, contract_id, _, _) = setup();
    let holder = Address::generate(&env);

    env.as_contract(&contract_id, || {
        use niffyinsure::types::Claim;
        let claim = Claim {
            claim_id: 1,
            policy_id: 1,
            claimant: holder.clone(),
            amount: 50_000_000,
            details: String::from_str(&env, "water damage"),
            image_urls: vec![&env],
            status: ClaimStatus::Processing,
            approve_votes: 0,
            reject_votes: 0,
            filed_at: 1,
        };
        storage::set_claim(&env, &claim);
        let loaded = storage::get_claim(&env, 1).expect("claim must exist");
        assert_eq!(loaded.amount, 50_000_000);
        assert_eq!(loaded.status, ClaimStatus::Processing);
    });
}

// ── persistent-tier: vote read/write ─────────────────────────────────────────

#[test]
fn set_and_get_vote_round_trip() {
    let (env, contract_id, _, _) = setup();
    let voter = Address::generate(&env);

    env.as_contract(&contract_id, || {
        assert!(storage::get_vote(&env, 1, &voter).is_none());
        storage::set_vote(&env, 1, &voter, &VoteOption::Approve);
        assert_eq!(
            storage::get_vote(&env, 1, &voter).unwrap(),
            VoteOption::Approve
        );
    });
}

// ── file_claim error: policy not found ───────────────────────────────────────

#[test]
fn file_claim_fails_when_policy_not_found() {
    let (env, contract_id, _, _) = setup();
    let client = NiffyInsureClient::new(&env, &contract_id);
    let holder = Address::generate(&env);
    let details = String::from_str(&env, "damage");
    let urls = vec![&env];
    let result = client.try_file_claim(&holder, &1u32, &50_000_000i128, &details, &urls);
    assert!(result.is_err());
}

// ── full multi-step flow: file → vote → approve ───────────────────────────────

#[test]
fn full_claim_vote_flow_approve() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    // Register a real SAC token so the payout transfer succeeds.
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_addr = sac.address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    client.initialize(&admin, &token_addr);

    // Mint enough tokens into the contract so it can pay out.
    token_client.mint(&contract_id, &200_000_000i128);

    let holder = Address::generate(&env);
    let voter2 = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_policy(&env, &make_policy(&holder, 1));
        storage::add_voter(&env, &holder);
        storage::add_voter(&env, &voter2);
    });

    let details = String::from_str(&env, "roof collapsed");
    let claim_id = client.file_claim(&holder, &1u32, &50_000_000i128, &details, &vec![&env]);
    assert_eq!(claim_id, 1u64);
    assert_eq!(client.get_claim_counter(), 1u64);

    // 1 of 2 votes — not yet majority
    let s1 = client.vote_on_claim(&holder, &claim_id, &VoteOption::Approve);
    assert_eq!(s1, ClaimStatus::Processing);

    // 2 of 2 votes — majority reached → Approved
    let s2 = client.vote_on_claim(&voter2, &claim_id, &VoteOption::Approve);
    assert_eq!(s2, ClaimStatus::Approved);

    // Admin triggers payout for the approved claim.
    client.process_claim(&claim_id);

    // Verify payout landed in claimant's account.
    let token_ro = soroban_sdk::token::TokenClient::new(&env, &token_addr);
    assert_eq!(token_ro.balance(&holder), 50_000_000i128);
}

// ── full multi-step flow: file → vote → reject ────────────────────────────────

#[test]
fn full_claim_vote_flow_reject() {
    let (env, contract_id, _, _) = setup();
    let client = NiffyInsureClient::new(&env, &contract_id);
    let holder = Address::generate(&env);
    let voter2 = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_policy(&env, &make_policy(&holder, 1));
        storage::add_voter(&env, &holder);
        storage::add_voter(&env, &voter2);
    });

    let details = String::from_str(&env, "fraudulent claim");
    let claim_id = client.file_claim(&holder, &1u32, &10_000_000i128, &details, &vec![&env]);

    client.vote_on_claim(&holder, &claim_id, &VoteOption::Reject);
    let status = client.vote_on_claim(&voter2, &claim_id, &VoteOption::Reject);
    assert_eq!(status, ClaimStatus::Rejected);
}

// ── duplicate vote rejected ───────────────────────────────────────────────────

#[test]
fn duplicate_vote_is_rejected() {
    let (env, contract_id, _, _) = setup();
    let client = NiffyInsureClient::new(&env, &contract_id);
    let holder = Address::generate(&env);
    let voter2 = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_policy(&env, &make_policy(&holder, 1));
        storage::add_voter(&env, &holder);
        storage::add_voter(&env, &voter2);
    });

    let details = String::from_str(&env, "fire damage");
    let claim_id = client.file_claim(&holder, &1u32, &20_000_000i128, &details, &vec![&env]);

    client.vote_on_claim(&holder, &claim_id, &VoteOption::Approve);
    let dup = client.try_vote_on_claim(&holder, &claim_id, &VoteOption::Approve);
    assert!(dup.is_err());
}

// ── non-voter cannot vote ─────────────────────────────────────────────────────

#[test]
fn non_voter_cannot_vote() {
    let (env, contract_id, _, _) = setup();
    let client = NiffyInsureClient::new(&env, &contract_id);
    let holder = Address::generate(&env);
    let outsider = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_policy(&env, &make_policy(&holder, 1));
        storage::add_voter(&env, &holder);
        // outsider NOT added
    });

    let details = String::from_str(&env, "theft");
    let claim_id = client.file_claim(&holder, &1u32, &30_000_000i128, &details, &vec![&env]);

    let result = client.try_vote_on_claim(&outsider, &claim_id, &VoteOption::Approve);
    assert!(result.is_err());
}

// ── counter immutability: generate_premium does not mutate storage ────────────

#[test]
fn generate_premium_does_not_mutate_counters() {
    use niffyinsure::types::{AgeBand, CoverageType, RegionTier, RiskInput};

    let (env, contract_id, _, _) = setup();
    let client = NiffyInsureClient::new(&env, &contract_id);
    let holder = Address::generate(&env);

    let before_cc = client.get_claim_counter();
    let before_pc = client.get_policy_counter(&holder);

    let input = RiskInput {
        region: RegionTier::Medium,
        age_band: AgeBand::Adult,
        coverage: CoverageType::Standard,
        safety_score: 0,
    };
    client.generate_premium(&input, &10_000_000i128, &false);

    assert_eq!(before_cc, client.get_claim_counter());
    assert_eq!(before_pc, client.get_policy_counter(&holder));
}
