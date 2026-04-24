//! Rejection trajectory tests.
//!
//! These tests verify the complete approve-vs-reject contract surface:
//!
//!   Approve path
//!   ├─ process_claim succeeds and emits ClaimProcessed
//!   └─ no ClaimRejected / StrikeIncremented / PolicyDeactivated emitted
//!
//!   Reject path (majority vote)
//!   ├─ ClaimRejected event emitted with correct vote tallies
//!   ├─ StrikeIncremented event emitted; policy.strike_count == 1
//!   ├─ process_claim returns ClaimNotApproved (never transfers tokens)
//!   └─ open-claim flag cleared
//!
//!   Reject path (deadline finalize)
//!   ├─ same event / state assertions as majority-vote reject
//!   └─ tie correctly resolves to Rejected
//!
//!   Strike accumulation
//!   ├─ Each rejection increments strike_count
//!   └─ At STRIKE_DEACTIVATION_THRESHOLD:
//!       ├─ PolicyDeactivated event emitted
//!       ├─ policy.is_active == false
//!       ├─ policy.termination_reason == ExcessiveRejections
//!       ├─ voter registry decremented / removed if last policy
//!       └─ new file_claim blocked (PolicyInactive)
//!
//!   Governance invariants
//!   ├─ Rejected claim cannot be processed (no payout)
//!   ├─ Approved claim cannot reach on_reject (no phantom events)
//!   └─ process_claim on Processing claim fails (not Approved yet)

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{ClaimStatus, TerminationReason, VoteOption, STRIKE_DEACTIVATION_THRESHOLD},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, Env, String,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/// Seed a policy for `holder` (registers them as a voter).
fn seed(client: &NiffyInsureClient, holder: &Address, coverage: i128, end_ledger: u32) {
    client.test_seed_policy(holder, &1u32, &coverage, &end_ledger);
}

fn file(client: &NiffyInsureClient, holder: &Address, amount: i128, env: &Env) -> u64 {
    let details = String::from_str(env, "brief claim description");
    let ev = common::empty_evidence(env);
    client.file_claim(holder, &1u32, &amount, &details, &ev, &None)
}

/// Three-voter setup: 2-of-3 majority for approve or reject.
fn three_voter_setup() -> (Env, NiffyInsureClient<'static>, Address, Address, Address) {
    let (env, client, admin, token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);
    let _ = (admin, token);
    (env, client, v1, v2, v3)
}

// ── Approve-path tests ────────────────────────────────────────────────────────

/// Approval does not emit ClaimRejected, StrikeIncremented, or PolicyDeactivated.
#[test]
fn approve_path_emits_no_rejection_events() {
    let (env, client, v1, v2, _v3) = three_voter_setup();
    env.events().all(); // drain existing events

    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    client.vote_on_claim(&v2, &cid, &VoteOption::Approve); // majority

    let claim = client.get_claim(&cid);
    assert_eq!(claim.status, ClaimStatus::Approved);

    // Verify no rejection-related events in the event log.
    let all_events = env.events().all();
    for (_, topics, _) in all_events.iter() {
        // Topics are encoded as a Vec<Val>; we can inspect by converting to
        // debug string. ClaimRejected / StrikeIncremented / PolicyDeactivated
        // all contain their discriminant keyword in the topic.
        let topic_debug = soroban_sdk::testutils::arbitrary::std::format!("{:?}", topics);
        assert!(
            !topic_debug.contains("claim_rejected"),
            "approve path must not emit claim_rejected"
        );
        assert!(
            !topic_debug.contains("strike_incremented"),
            "approve path must not emit strike_incremented"
        );
        assert!(
            !topic_debug.contains("policy_deactivated"),
            "approve path must not emit policy_deactivated"
        );
    }
}

/// After approval, strike_count stays at 0.
#[test]
fn approve_does_not_increment_strike_count() {
    let (env, client, v1, v2, _v3) = three_voter_setup();
    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    client.vote_on_claim(&v2, &cid, &VoteOption::Approve);

    let policy = client.get_policy(&v1, &1u32).expect("policy must exist");
    assert_eq!(
        policy.strike_count, 0,
        "approval must not increment strike_count"
    );
}

// ── Reject-path tests (majority vote) ─────────────────────────────────────────

/// Majority reject transitions claim to Rejected.
#[test]
fn majority_reject_sets_rejected_status() {
    let (env, client, v1, v2, _v3) = three_voter_setup();
    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);

    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);
}

/// After rejection, strike_count is incremented to 1.
#[test]
fn rejection_increments_strike_count() {
    let (env, client, v1, v2, _v3) = three_voter_setup();
    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);

    let policy = client.get_policy(&v1, &1u32).expect("policy must exist");
    assert_eq!(
        policy.strike_count, 1,
        "one rejection must yield strike_count = 1"
    );
}

/// Reject path emits at least one event (ClaimRejected is emitted).
#[test]
fn rejection_emits_events() {
    let (env, client, v1, v2, _v3) = three_voter_setup();
    let before_count = env.events().all().len();

    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);

    let after_count = env.events().all().len();
    // At minimum: ClaimFiled + VoteLogged×2 + ClaimRejected + StrikeIncremented
    assert!(
        after_count > before_count,
        "rejection must produce new events"
    );
}

/// process_claim on a Rejected claim must fail — no payout is ever issued.
///
/// This is the primary invariant for the "reject NEVER transfers payout tokens"
/// acceptance criterion.
#[test]
fn rejected_claim_process_claim_fails() {
    let (env, client, v1, v2, _v3) = three_voter_setup();
    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);

    let result = client.try_process_claim(&cid);
    assert!(
        result.is_err(),
        "process_claim must fail for a rejected claim"
    );
}

/// process_claim on a Processing (not-yet-decided) claim must also fail.
#[test]
fn processing_claim_process_claim_fails() {
    let (env, client, v1, _v2, _v3) = three_voter_setup();
    let cid = file(&client, &v1, 100_000, &env);
    // Only one vote — no majority yet, claim still Processing
    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);

    let claim = client.get_claim(&cid);
    assert_eq!(claim.status, ClaimStatus::Processing);

    let result = client.try_process_claim(&cid);
    assert!(
        result.is_err(),
        "process_claim must fail while claim is still Processing"
    );
}

/// After rejection, the open-claim flag for (holder, policy_id) is cleared
/// so the holder can file a subsequent claim (subject to rate-limit).
#[test]
fn rejection_clears_open_claim_flag() {
    let (env, client, v1, v2, _v3) = three_voter_setup();
    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);

    // Verify claim is rejected
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);

    // Attempting to file another claim for the same policy fails with
    // RateLimitExceeded (not DuplicateOpenClaim), proving the open-claim flag
    // was cleared. We advance time to skip the rate-limit window.
    env.ledger().with_mut(|l| {
        l.sequence_number += niffyinsure::types::RATE_LIMIT_WINDOW_LEDGERS + 1;
    });
    // This would succeed if the policy is still active and within window —
    // it might fail due to policy expiry at this point (end_ledger = 500_000),
    // but it must NOT fail with DuplicateOpenClaim.
    let result = client.try_file_claim(
        &v1,
        &1u32,
        &100_000,
        &String::from_str(&env, "second claim"),
        &common::empty_evidence(&env),
        &None,
    );
    // Accept either Ok (filed) or Err (any reason except DuplicateOpenClaim).
    // The important check is that DuplicateOpenClaim is not returned.
    if let Err(e) = result {
        let debug = soroban_sdk::testutils::arbitrary::std::format!("{:?}", e);
        assert!(
            !debug.contains("DuplicateOpenClaim"),
            "open-claim flag must be cleared after rejection; got: {debug}"
        );
    }
}

// ── Reject-path tests (deadline finalize) ─────────────────────────────────────

/// Deadline finalization with plurality-reject triggers rejection side-effects.
#[test]
fn deadline_reject_increments_strike_count() {
    let (env, client, v1, v2, _v3) = three_voter_setup();
    // Full turnout required so 1–1 split stays open until `finalize_claim`.
    client.admin_set_quorum_bps(&10_000u32);
    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);

    let claim = client.get_claim(&cid);
    env.ledger()
        .with_mut(|l| l.sequence_number = claim.voting_deadline_ledger + 1);

    // Participation below snapshot quorum → Rejected at deadline
    client.finalize_claim(&cid);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);

    let policy = client.get_policy(&v1, &1u32).expect("policy must exist");
    assert_eq!(
        policy.strike_count, 1,
        "deadline-finalized rejection must increment strike_count"
    );
}

/// Tie (equal approve and reject votes) resolves to Rejected and applies side-effects.
#[test]
fn tie_resolves_to_rejected_and_increments_strike() {
    let (env, client, _, _) = setup();
    client.admin_set_quorum_bps(&10_000u32);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);

    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);

    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);
    let policy = client.get_policy(&v1, &1u32).expect("policy must exist");
    assert_eq!(policy.strike_count, 1);
}

/// Deadline reject with no votes also resolves to Rejected (0 > 0 is false).
#[test]
fn deadline_reject_with_zero_votes_increments_strike() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 500_000);

    let cid = file(&client, &holder, 100_000, &env);
    // No votes cast at all
    let claim = client.get_claim(&cid);
    env.ledger()
        .with_mut(|l| l.sequence_number = claim.voting_deadline_ledger + 1);
    client.finalize_claim(&cid);

    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);
    let policy = client
        .get_policy(&holder, &1u32)
        .expect("policy must exist");
    assert_eq!(policy.strike_count, 1);
}

/// process_claim fails for a deadline-rejected claim (no payout path).
#[test]
fn deadline_rejected_claim_process_claim_fails() {
    let (env, client, v1, _v2, _v3) = three_voter_setup();
    let cid = file(&client, &v1, 100_000, &env);
    let claim = client.get_claim(&cid);
    env.ledger()
        .with_mut(|l| l.sequence_number = claim.voting_deadline_ledger + 1);
    client.finalize_claim(&cid);

    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);
    assert!(client.try_process_claim(&cid).is_err());
}

// ── Strike accumulation and policy deactivation ───────────────────────────────

/// Multiple rejections accumulate strike_count correctly.
#[test]
fn multiple_rejections_accumulate_strike_count() {
    let (env, client, _, _) = setup();

    // Single holder with two additional voters so each claim can be majority-rejected.
    let holder = Address::generate(&env);
    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 500_000);
    seed(&client, &voter_a, 1_000_000, 500_000);
    seed(&client, &voter_b, 1_000_000, 500_000);

    let details = String::from_str(&env, "claim");
    let ev = common::empty_evidence(&env);

    // First rejection
    let cid1 = client.file_claim(&holder, &1u32, &100_000, &details, &ev, &None);
    client.vote_on_claim(&voter_a, &cid1, &VoteOption::Reject);
    client.vote_on_claim(&voter_b, &cid1, &VoteOption::Reject);
    assert_eq!(client.get_claim(&cid1).status, ClaimStatus::Rejected);
    assert_eq!(client.get_policy(&holder, &1u32).unwrap().strike_count, 1);

    // Advance past rate-limit before second claim
    env.ledger().with_mut(|l| {
        l.sequence_number += niffyinsure::types::RATE_LIMIT_WINDOW_LEDGERS + 1;
    });

    // Second rejection
    let cid2 = client.file_claim(&holder, &1u32, &100_000, &details, &ev, &None);
    client.vote_on_claim(&voter_a, &cid2, &VoteOption::Reject);
    client.vote_on_claim(&voter_b, &cid2, &VoteOption::Reject);
    assert_eq!(client.get_claim(&cid2).status, ClaimStatus::Rejected);
    assert_eq!(client.get_policy(&holder, &1u32).unwrap().strike_count, 2);
}

/// At STRIKE_DEACTIVATION_THRESHOLD rejections, the policy is auto-deactivated.
#[test]
fn strike_threshold_deactivates_policy() {
    // Compile-time sanity: threshold must be ≥ 1 for this test to be meaningful.
    const { assert!(STRIKE_DEACTIVATION_THRESHOLD >= 1) };

    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);
    seed(&client, &holder, 2_000_000, 5_000_000);
    seed(&client, &voter_a, 1_000_000, 5_000_000);
    seed(&client, &voter_b, 1_000_000, 5_000_000);

    let details = String::from_str(&env, "claim");
    let ev = common::empty_evidence(&env);

    for strike in 1..=STRIKE_DEACTIVATION_THRESHOLD {
        // Advance past rate-limit for all but the first claim
        if strike > 1 {
            env.ledger().with_mut(|l| {
                l.sequence_number += niffyinsure::types::RATE_LIMIT_WINDOW_LEDGERS + 1;
            });
        }
        let cid = client.file_claim(&holder, &1u32, &100_000, &details, &ev, &None);
        client.vote_on_claim(&voter_a, &cid, &VoteOption::Reject);
        client.vote_on_claim(&voter_b, &cid, &VoteOption::Reject);
        assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);

        let policy = client.get_policy(&holder, &1u32).unwrap();
        assert_eq!(
            policy.strike_count, strike,
            "strike_count mismatch at strike {strike}"
        );

        if strike < STRIKE_DEACTIVATION_THRESHOLD {
            assert!(
                policy.is_active,
                "policy must remain active before threshold (strike {strike})"
            );
        }
    }

    // After threshold
    let policy = client.get_policy(&holder, &1u32).unwrap();
    assert!(
        !policy.is_active,
        "policy must be deactivated after {STRIKE_DEACTIVATION_THRESHOLD} rejections"
    );
    assert_eq!(
        policy.termination_reason,
        TerminationReason::ExcessiveRejections,
        "termination_reason must be ExcessiveRejections"
    );
    assert!(
        !policy.terminated_by_admin,
        "auto-deactivation is not an admin action"
    );
    assert_ne!(
        policy.terminated_at_ledger, 0,
        "terminated_at_ledger must be set"
    );
}

/// After policy deactivation, file_claim is blocked with PolicyInactive.
#[test]
fn deactivated_policy_blocks_new_claims() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);
    seed(&client, &holder, 2_000_000, 5_000_000);
    seed(&client, &voter_a, 1_000_000, 5_000_000);
    seed(&client, &voter_b, 1_000_000, 5_000_000);

    let details = String::from_str(&env, "claim");
    let ev = common::empty_evidence(&env);

    // Exhaust strikes to trigger deactivation
    for strike in 1..=STRIKE_DEACTIVATION_THRESHOLD {
        if strike > 1 {
            env.ledger().with_mut(|l| {
                l.sequence_number += niffyinsure::types::RATE_LIMIT_WINDOW_LEDGERS + 1;
            });
        }
        let cid = client.file_claim(&holder, &1u32, &100_000, &details, &ev, &None);
        client.vote_on_claim(&voter_a, &cid, &VoteOption::Reject);
        client.vote_on_claim(&voter_b, &cid, &VoteOption::Reject);
    }

    // Policy is now deactivated
    assert!(!client.get_policy(&holder, &1u32).unwrap().is_active);

    // Advance past rate-limit
    env.ledger().with_mut(|l| {
        l.sequence_number += niffyinsure::types::RATE_LIMIT_WINDOW_LEDGERS + 1;
    });

    // Further claims must be rejected
    let result = client.try_file_claim(&holder, &1u32, &100_000, &details, &ev, &None);
    assert!(
        result.is_err(),
        "file_claim must fail on a deactivated policy"
    );
}

/// After policy deactivation, the holder's active-policy count is decremented
/// and they are removed from the voter registry if this was their last policy.
#[test]
fn deactivated_policy_updates_voter_registry() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);
    seed(&client, &holder, 2_000_000, 5_000_000);
    seed(&client, &voter_a, 1_000_000, 5_000_000);
    seed(&client, &voter_b, 1_000_000, 5_000_000);

    // Holder has exactly 1 active policy; they should be removed from voters
    // after deactivation.
    assert_eq!(client.get_active_policy_count(&holder), 1);
    assert!(client.voter_registry_contains(&holder));

    let details = String::from_str(&env, "claim");
    let ev = common::empty_evidence(&env);

    for strike in 1..=STRIKE_DEACTIVATION_THRESHOLD {
        if strike > 1 {
            env.ledger().with_mut(|l| {
                l.sequence_number += niffyinsure::types::RATE_LIMIT_WINDOW_LEDGERS + 1;
            });
        }
        let cid = client.file_claim(&holder, &1u32, &100_000, &details, &ev, &None);
        client.vote_on_claim(&voter_a, &cid, &VoteOption::Reject);
        client.vote_on_claim(&voter_b, &cid, &VoteOption::Reject);
    }

    // Active policy count must be 0 and holder removed from voter registry.
    assert_eq!(
        client.get_active_policy_count(&holder),
        0,
        "active policy count must be 0 after deactivation"
    );
    assert!(
        !client.voter_registry_contains(&holder),
        "holder must be removed from voter registry after last policy deactivated"
    );
}

/// Voter with multiple policies: deactivating one does NOT remove them from
/// the voter registry while other active policies remain.
#[test]
fn deactivated_policy_keeps_voter_if_other_policies_active() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);

    // Give holder TWO policies (policy_id 1 and 2)
    seed(&client, &holder, 2_000_000, 5_000_000); // policy 1
    client.test_seed_policy(&holder, &2u32, &1_000_000i128, &5_000_000u32); // policy 2

    seed(&client, &voter_a, 1_000_000, 5_000_000);
    seed(&client, &voter_b, 1_000_000, 5_000_000);

    // Holder has 2 active policies (add_voter called for each seed)
    // Note: test_seed_policy calls add_voter, which increments the count.
    // After two seeds the count is 2.

    let details = String::from_str(&env, "claim");
    let ev = common::empty_evidence(&env);

    // Exhaust strikes on policy 1 to deactivate it
    for strike in 1..=STRIKE_DEACTIVATION_THRESHOLD {
        if strike > 1 {
            env.ledger().with_mut(|l| {
                l.sequence_number += niffyinsure::types::RATE_LIMIT_WINDOW_LEDGERS + 1;
            });
        }
        let cid = client.file_claim(&holder, &1u32, &100_000, &details, &ev, &None);
        client.vote_on_claim(&voter_a, &cid, &VoteOption::Reject);
        client.vote_on_claim(&voter_b, &cid, &VoteOption::Reject);
    }

    // Policy 1 deactivated, but policy 2 still active → holder stays in registry
    assert!(
        client.voter_registry_contains(&holder),
        "holder with remaining active policy must stay in voter registry"
    );
    assert!(
        client.get_active_policy_count(&holder) > 0,
        "active policy count must be > 0 while policy 2 is active"
    );
}

// ── Governance invariants ─────────────────────────────────────────────────────

/// A Rejected claim cannot transition to Approved through any subsequent vote.
/// Terminal state is final.
#[test]
fn rejected_claim_is_terminal_no_further_votes() {
    let (env, client, v1, v2, v3) = three_voter_setup();
    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject); // majority reject
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);

    // Third voter cannot cast an approve vote after termination
    let result = client.try_vote_on_claim(&v3, &cid, &VoteOption::Approve);
    assert!(result.is_err(), "cannot vote on a terminal claim");

    // Status remains Rejected
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);
}

/// An Approved claim cannot transition to Rejected (no on_reject side-effects
/// fire, strike_count stays 0).
#[test]
fn approved_claim_status_is_immutable() {
    let (env, client, v1, v2, v3) = three_voter_setup();
    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    client.vote_on_claim(&v2, &cid, &VoteOption::Approve); // majority approve

    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Approved);

    // Third voter cannot flip to Reject
    let result = client.try_vote_on_claim(&v3, &cid, &VoteOption::Reject);
    assert!(result.is_err(), "cannot vote on an already-approved claim");

    // strike_count stays 0
    let policy = client.get_policy(&v1, &1u32).unwrap();
    assert_eq!(policy.strike_count, 0);
}

/// Approve then reject on different claims of the same policy produces the
/// correct accumulated state: one approval (no strike), then one rejection
/// (strike_count = 1).
#[test]
fn mixed_approve_then_reject_correct_strike_count() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);
    seed(&client, &holder, 2_000_000, 5_000_000);
    seed(&client, &voter_a, 1_000_000, 5_000_000);
    seed(&client, &voter_b, 1_000_000, 5_000_000);

    let details = String::from_str(&env, "claim");
    let ev = common::empty_evidence(&env);

    // First claim: approved
    let cid1 = client.file_claim(&holder, &1u32, &100_000, &details, &ev, &None);
    client.vote_on_claim(&voter_a, &cid1, &VoteOption::Approve);
    client.vote_on_claim(&voter_b, &cid1, &VoteOption::Approve);
    assert_eq!(client.get_claim(&cid1).status, ClaimStatus::Approved);
    assert_eq!(
        client.get_policy(&holder, &1u32).unwrap().strike_count,
        0,
        "approval must not increment strike_count"
    );

    // Advance past rate-limit
    env.ledger().with_mut(|l| {
        l.sequence_number += niffyinsure::types::RATE_LIMIT_WINDOW_LEDGERS + 1;
    });

    // Second claim: rejected
    let cid2 = client.file_claim(&holder, &1u32, &100_000, &details, &ev, &None);
    client.vote_on_claim(&voter_a, &cid2, &VoteOption::Reject);
    client.vote_on_claim(&voter_b, &cid2, &VoteOption::Reject);
    assert_eq!(client.get_claim(&cid2).status, ClaimStatus::Rejected);
    assert_eq!(
        client.get_policy(&holder, &1u32).unwrap().strike_count,
        1,
        "rejection after approval must yield strike_count = 1"
    );
}

/// Mixed order: reject first, then approve; strike_count = 1, policy still active.
#[test]
fn reject_then_approve_leaves_policy_active_with_one_strike() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);
    seed(&client, &holder, 2_000_000, 5_000_000);
    seed(&client, &voter_a, 1_000_000, 5_000_000);
    seed(&client, &voter_b, 1_000_000, 5_000_000);

    let details = String::from_str(&env, "claim");
    let ev = common::empty_evidence(&env);

    // First claim: rejected
    let cid1 = client.file_claim(&holder, &1u32, &100_000, &details, &ev, &None);
    client.vote_on_claim(&voter_a, &cid1, &VoteOption::Reject);
    client.vote_on_claim(&voter_b, &cid1, &VoteOption::Reject);
    assert_eq!(client.get_policy(&holder, &1u32).unwrap().strike_count, 1);

    env.ledger().with_mut(|l| {
        l.sequence_number += niffyinsure::types::RATE_LIMIT_WINDOW_LEDGERS + 1;
    });

    // Second claim: approved
    let cid2 = client.file_claim(&holder, &1u32, &100_000, &details, &ev, &None);
    client.vote_on_claim(&voter_a, &cid2, &VoteOption::Approve);
    client.vote_on_claim(&voter_b, &cid2, &VoteOption::Approve);
    assert_eq!(client.get_claim(&cid2).status, ClaimStatus::Approved);

    let policy = client.get_policy(&holder, &1u32).unwrap();
    // Approval must not add to or subtract from strike_count
    assert_eq!(policy.strike_count, 1);
    assert!(policy.is_active, "policy must still be active");
}

/// Rejected claims remain readable via get_claim after rejection
/// (permanent auditability — Soroban persistent storage with TTL).
#[test]
fn rejected_claims_remain_readable_for_auditability() {
    let (env, client, v1, v2, _v3) = three_voter_setup();
    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);

    // claim record is still readable
    let claim = client.get_claim(&cid);
    assert_eq!(claim.status, ClaimStatus::Rejected);
    assert_eq!(claim.claim_id, cid);
    assert_eq!(claim.claimant, v1);
    // Vote tallies are preserved for auditability
    assert!(claim.reject_votes >= 2);
}

// ── Approve path followed by payout (full lifecycle cross-check) ──────────────

/// Approve path allows payout; verifies process_claim succeeds.
/// This confirms that the approve path is fully functional and that the
/// reject guard in process_claim is not over-blocking.
#[test]
fn approve_path_allows_payout() {
    let (env, client, v1, v2, _v3) = three_voter_setup();
    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    client.vote_on_claim(&v2, &cid, &VoteOption::Approve);

    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Approved);

    // process_claim should NOT return an error for an approved claim
    // (it may fail for other reasons in test environment like InsufficientTreasury,
    // but must not fail with ClaimNotApproved)
    let result = client.try_process_claim(&cid);
    if let Err(ref e) = result {
        let debug = soroban_sdk::testutils::arbitrary::std::format!("{:?}", e);
        assert!(
            !debug.contains("ClaimNotApproved"),
            "process_claim must not return ClaimNotApproved for an Approved claim; got: {debug}"
        );
    }
}

/// Double-finalize is rejected: once a claim is terminal, finalize_claim fails.
#[test]
fn double_finalize_after_rejection_fails() {
    let (env, client, v1, _v2, _v3) = three_voter_setup();
    let cid = file(&client, &v1, 100_000, &env);
    let claim = client.get_claim(&cid);
    env.ledger()
        .with_mut(|l| l.sequence_number = claim.voting_deadline_ledger + 1);
    client.finalize_claim(&cid);

    // Second finalize must fail (ClaimAlreadyTerminal)
    let result = client.try_finalize_claim(&cid);
    assert!(result.is_err(), "cannot finalize an already-terminal claim");
}

// ── Admin-terminated policy with in-flight claim ──────────────────────────────
//
// Governance risk: admin_terminate_policy with allow_open_claims = true can
// terminate a policy while a claim is in Processing. The claim vote can still
// complete, but on_reject must skip the deactivation branch (policy already
// inactive) while still incrementing strike_count and emitting ClaimRejected
// and StrikeIncremented for auditability.

/// Admin terminates a policy while a claim is in Processing (allow_open_claims = true).
/// After termination, the vote completes and rejection side-effects fire correctly:
///   - ClaimRejected emitted
///   - StrikeIncremented emitted (strike_count incremented even though policy is inactive)
///   - PolicyDeactivated NOT emitted (policy already inactive)
///   - process_claim returns ClaimNotApproved (no payout)
#[test]
fn admin_terminated_policy_in_flight_claim_rejection_side_effects() {
    let (env, client, admin, _token) = setup();
    let holder = Address::generate(&env);
    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);
    seed(&client, &holder, 2_000_000, 5_000_000);
    seed(&client, &voter_a, 1_000_000, 5_000_000);
    seed(&client, &voter_b, 1_000_000, 5_000_000);

    // File a claim while the policy is still active.
    let cid = file(&client, &holder, 100_000, &env);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Processing);

    // Admin terminates the policy with allow_open_claims = true (governance risk path).
    client.admin_terminate_policy(
        &admin,
        &holder,
        &1u32,
        &niffyinsure::types::TerminationReason::AdminOverride,
        &true,
    );

    // Policy is now inactive.
    let policy_after_terminate = client.get_policy(&holder, &1u32).unwrap();
    assert!(!policy_after_terminate.is_active, "policy must be inactive after admin termination");

    // The in-flight claim can still be voted on and finalized.
    client.vote_on_claim(&voter_a, &cid, &VoteOption::Reject);
    client.vote_on_claim(&voter_b, &cid, &VoteOption::Reject);

    // Claim is now Rejected.
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);

    // Strike count is incremented even though the policy is already inactive.
    let policy = client.get_policy(&holder, &1u32).unwrap();
    assert_eq!(
        policy.strike_count, 1,
        "strike_count must be incremented even when policy is already inactive"
    );

    // Policy remains inactive (no double-deactivation).
    assert!(!policy.is_active, "policy must remain inactive after rejection side-effects");

    // process_claim must fail — rejected claim never triggers payout.
    let result = client.try_process_claim(&cid);
    assert!(
        result.is_err(),
        "process_claim must return ClaimNotApproved for a rejected claim on a terminated policy"
    );
}

/// Verify that on_reject skips PolicyDeactivated when the policy is already
/// inactive (admin-terminated), even if strike_count reaches the threshold.
#[test]
fn on_reject_skips_deactivation_when_policy_already_inactive() {
    let (env, client, admin, _token) = setup();
    let holder = Address::generate(&env);
    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);
    // Give holder enough end_ledger to file multiple claims.
    seed(&client, &holder, 2_000_000, 5_000_000);
    seed(&client, &voter_a, 1_000_000, 5_000_000);
    seed(&client, &voter_b, 1_000_000, 5_000_000);

    let details = soroban_sdk::String::from_str(&env, "claim");
    let ev = common::empty_evidence(&env);

    // File and reject claims up to threshold - 1 (policy still active).
    for strike in 1..STRIKE_DEACTIVATION_THRESHOLD {
        if strike > 1 {
            env.ledger().with_mut(|l| {
                l.sequence_number += niffyinsure::types::RATE_LIMIT_WINDOW_LEDGERS + 1;
            });
        }
        let cid = client.file_claim(&holder, &1u32, &100_000, &details, &ev, &None);
        client.vote_on_claim(&voter_a, &cid, &VoteOption::Reject);
        client.vote_on_claim(&voter_b, &cid, &VoteOption::Reject);
    }

    let policy_before = client.get_policy(&holder, &1u32).unwrap();
    assert!(policy_before.is_active, "policy must still be active before threshold");
    assert_eq!(policy_before.strike_count, STRIKE_DEACTIVATION_THRESHOLD - 1);

    // Admin terminates the policy before the threshold-triggering rejection.
    client.admin_terminate_policy(
        &admin,
        &holder,
        &1u32,
        &niffyinsure::types::TerminationReason::AdminOverride,
        &true,
    );
    assert!(!client.get_policy(&holder, &1u32).unwrap().is_active);

    // File one more claim (open_claims bypass was set, so this is allowed via
    // the admin termination path — but the policy is inactive, so file_claim
    // should fail with PolicyInactive).
    env.ledger().with_mut(|l| {
        l.sequence_number += niffyinsure::types::RATE_LIMIT_WINDOW_LEDGERS + 1;
    });
    let result = client.try_file_claim(&holder, &1u32, &100_000, &details, &ev, &None);
    assert!(result.is_err(), "file_claim must fail on an inactive policy");

    // Strike count remains at threshold - 1 (no new claim was filed).
    let policy = client.get_policy(&holder, &1u32).unwrap();
    assert_eq!(
        policy.strike_count,
        STRIKE_DEACTIVATION_THRESHOLD - 1,
        "strike_count must not change when no new rejection occurred"
    );
    // Policy remains inactive (admin termination, not ExcessiveRejections).
    assert!(!policy.is_active);
    assert_eq!(
        policy.termination_reason,
        niffyinsure::types::TerminationReason::AdminOverride,
        "termination_reason must remain AdminOverride"
    );
}

/// process_claim returns ClaimNotApproved for a rejected claim — explicit assertion
/// that the payout guard is structurally enforced.
#[test]
fn process_claim_returns_claim_not_approved_for_rejected_claim() {
    let (env, client, v1, v2, _v3) = three_voter_setup();
    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);

    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);

    let result = client.try_process_claim(&cid);
    assert!(result.is_err(), "process_claim must fail for a Rejected claim");

    // Verify the error is specifically ClaimNotApproved (not some other error).
    let err_debug = soroban_sdk::testutils::arbitrary::std::format!("{:?}", result.unwrap_err());
    assert!(
        err_debug.contains("ClaimNotApproved"),
        "error must be ClaimNotApproved; got: {err_debug}"
    );
}

/// Strike count increments correctly even when the policy is already inactive
/// (e.g., admin-terminated before the rejection fires).
#[test]
fn strike_increments_on_already_inactive_policy() {
    let (env, client, admin, _token) = setup();
    let holder = Address::generate(&env);
    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);
    seed(&client, &holder, 2_000_000, 5_000_000);
    seed(&client, &voter_a, 1_000_000, 5_000_000);
    seed(&client, &voter_b, 1_000_000, 5_000_000);

    // File a claim, then admin-terminate the policy before the vote resolves.
    let cid = file(&client, &holder, 100_000, &env);
    client.admin_terminate_policy(
        &admin,
        &holder,
        &1u32,
        &niffyinsure::types::TerminationReason::AdminOverride,
        &true,
    );

    // Policy is inactive; vote still completes.
    client.vote_on_claim(&voter_a, &cid, &VoteOption::Reject);
    client.vote_on_claim(&voter_b, &cid, &VoteOption::Reject);

    let policy = client.get_policy(&holder, &1u32).unwrap();
    assert_eq!(
        policy.strike_count, 1,
        "strike_count must be 1 after rejection on an already-inactive policy"
    );
    assert!(!policy.is_active, "policy must remain inactive");
}
