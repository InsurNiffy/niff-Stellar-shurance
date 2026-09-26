//! Property suite for the appeal state machine:
//!   Rejected → UnderAppeal → (AppealApproved | AppealRejected)
//!
//! Randomized vote sequences, voter-set sizes, and timing must never leave
//! the claim in an undefined / off-graph status.

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{ClaimStatus, VoteOption, APPEAL_VOTE_WINDOW_LEDGERS},
    NiffyInsureClient,
};
use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

/// Valid appeal-flow transitions (fixture graph for the property suite).
fn is_valid_appeal_transition(from: &ClaimStatus, to: &ClaimStatus) -> bool {
    matches!(
        (from, to),
        (ClaimStatus::Rejected, ClaimStatus::UnderAppeal)
            | (ClaimStatus::UnderAppeal, ClaimStatus::AppealApproved)
            | (ClaimStatus::UnderAppeal, ClaimStatus::AppealRejected)
            // Identity / no-op while still open
            | (ClaimStatus::UnderAppeal, ClaimStatus::UnderAppeal)
            | (ClaimStatus::Rejected, ClaimStatus::Rejected)
            // Terminal stays terminal
            | (ClaimStatus::AppealApproved, ClaimStatus::AppealApproved)
            | (ClaimStatus::AppealRejected, ClaimStatus::AppealRejected)
    )
}

fn is_defined_appeal_status(s: &ClaimStatus) -> bool {
    matches!(
        s,
        ClaimStatus::Rejected
            | ClaimStatus::UnderAppeal
            | ClaimStatus::AppealApproved
            | ClaimStatus::AppealRejected
    )
}

fn setup(env: &Env) -> NiffyInsureClient<'static> {
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token = Address::generate(env);
    client.initialize(&admin, &token);
    // Low base quorum so original reject resolves quickly; appeal uses elevated quorum.
    client.admin_set_quorum_bps(&5_000u32);
    client
}

fn seed_voters(client: &NiffyInsureClient, voters: &[Address]) {
    for v in voters {
        client.test_seed_policy(v, &1u32, &1_000_000i128, &500_000u32);
    }
}

fn file_and_reject(
    env: &Env,
    client: &NiffyInsureClient,
    claimant: &Address,
    voters: &[Address],
) -> u64 {
    let details = String::from_str(env, "appeal state-machine property");
    let ev = common::empty_evidence(env);
    let cid = client.file_claim(claimant, &1u32, &100_000i128, &details, &ev, &None);

    // Cast enough Reject votes to meet base quorum.
    for v in voters {
        let _ = client.try_vote_on_claim(v, &cid, &VoteOption::Reject);
    }
    assert_eq!(
        client.get_claim(&cid).status,
        ClaimStatus::Rejected,
        "setup must reach Rejected before appeal property run"
    );
    cid
}

/// One randomized appeal-flow scenario. Returns the final status.
fn run_scenario(seed: u64) -> ClaimStatus {
    let mut rng = StdRng::seed_from_u64(seed);
    let env = Env::default();
    let client = setup(&env);

    let voter_count = rng.gen_range(2..=5usize);
    let voters: Vec<Address> = (0..voter_count).map(|_| Address::generate(&env)).collect();
    let claimant = voters[0].clone();
    seed_voters(&client, &voters);

    let cid = file_and_reject(&env, &client, &claimant, &voters);
    let mut prev = ClaimStatus::Rejected;

    // Always open the appeal (required edge of the graph under test).
    client.open_appeal(&claimant, &cid);
    let mut status = client.get_claim(&cid).status;
    assert!(
        is_valid_appeal_transition(&prev, &status),
        "seed={seed}: invalid transition {:?} → {:?}",
        prev,
        status
    );
    prev = status.clone();
    assert_eq!(status, ClaimStatus::UnderAppeal);

    // Shuffle a random vote plan: each voter Approve / Reject / abstain.
    // Clone addresses so we can shuffle without borrow conflicts.
    let mut order = voters.clone();
    // Fisher–Yates via rand
    for i in (1..order.len()).rev() {
        let j = rng.gen_range(0..=i);
        order.swap(i, j);
    }

    let cast_count = rng.gen_range(0..=order.len());
    for v in order.iter().take(cast_count) {
        if !matches!(status, ClaimStatus::UnderAppeal) {
            break;
        }
        let approve = rng.gen_bool(0.5);
        let vote = if approve {
            VoteOption::Approve
        } else {
            VoteOption::Reject
        };
        let _ = client.try_vote_on_appeal(v, &cid, &vote);
        status = client.get_claim(&cid).status;
        assert!(
            is_defined_appeal_status(&status),
            "seed={seed}: undefined status after vote: {:?}",
            status
        );
        assert!(
            is_valid_appeal_transition(&prev, &status),
            "seed={seed}: invalid transition {:?} → {:?} after vote",
            prev,
            status
        );
        prev = status.clone();
    }

    // If still open, advance past the appeal deadline and finalize (permissionless).
    if matches!(status, ClaimStatus::UnderAppeal) {
        let deadline = client.get_claim(&cid).appeal_deadline_ledger;
        // Sometimes finalize exactly one past deadline; sometimes further out.
        let extra = rng.gen_range(1..=APPEAL_VOTE_WINDOW_LEDGERS.min(1_000));
        env.ledger()
            .with_mut(|l| l.sequence_number = deadline.saturating_add(extra));
        let _ = client.try_finalize_appeal(&cid);
        status = client.get_claim(&cid).status;
        assert!(
            is_defined_appeal_status(&status),
            "seed={seed}: undefined status after finalize: {:?}",
            status
        );
        assert!(
            is_valid_appeal_transition(&prev, &status),
            "seed={seed}: invalid transition {:?} → {:?} after finalize",
            prev,
            status
        );
    }

    // Terminal must be one of the two appeal outcomes (or still UnderAppeal only
    // if finalize somehow failed — which must not happen past deadline).
    assert!(
        matches!(
            status,
            ClaimStatus::AppealApproved | ClaimStatus::AppealRejected
        ),
        "seed={seed}: expected terminal appeal status, got {:?}",
        status
    );

    // Second finalize / open_appeal must not invent a new state.
    let again = client.try_finalize_appeal(&cid);
    assert!(again.is_err(), "seed={seed}: double finalize must Err");
    let after = client.get_claim(&cid).status;
    assert_eq!(after, status, "seed={seed}: status must be stable after terminal");
    assert!(is_valid_appeal_transition(&status, &after));

    let reopen = client.try_open_appeal(&claimant, &cid);
    assert!(reopen.is_err(), "seed={seed}: second open_appeal must Err");
    assert_eq!(client.get_claim(&cid).status, status);

    status
}

/// Fixed-seed property run wired into `cargo test` / CI.
#[test]
fn appeal_state_machine_never_reaches_undefined_state() {
    // Enough seeds to cover vote/timing diversity without blowing CI time.
    for seed in 0u64..64 {
        let _ = run_scenario(seed);
    }
}

/// Explicit fixture: approve-majority path ends in AppealApproved.
#[test]
fn appeal_graph_approve_path_reaches_appeal_approved() {
    let env = Env::default();
    let client = setup(&env);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed_voters(&client, &[v1.clone(), v2.clone(), v3.clone()]);

    let cid = file_and_reject(&env, &client, &v1, &[v1.clone(), v2.clone(), v3.clone()]);
    client.open_appeal(&v1, &cid);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::UnderAppeal);

    client.vote_on_appeal(&v1, &cid, &VoteOption::Approve);
    client.vote_on_appeal(&v2, &cid, &VoteOption::Approve);
    client.vote_on_appeal(&v3, &cid, &VoteOption::Approve);

    let status = client.get_claim(&cid).status;
    // May resolve mid-vote once elevated quorum + plurality are met.
    if matches!(status, ClaimStatus::UnderAppeal) {
        let deadline = client.get_claim(&cid).appeal_deadline_ledger;
        env.ledger()
            .with_mut(|l| l.sequence_number = deadline + 1);
        let finalized = client.finalize_appeal(&cid);
        assert_eq!(finalized, ClaimStatus::AppealApproved);
    } else {
        assert_eq!(status, ClaimStatus::AppealApproved);
    }
}

/// Explicit fixture: reject / quorum-fail path ends in AppealRejected.
#[test]
fn appeal_graph_reject_path_reaches_appeal_rejected() {
    let env = Env::default();
    let client = setup(&env);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    seed_voters(&client, &[v1.clone(), v2.clone()]);

    let cid = file_and_reject(&env, &client, &v1, &[v1.clone(), v2.clone()]);
    client.open_appeal(&v1, &cid);

    // No votes — past deadline → insurer-favored AppealRejected.
    let deadline = client.get_claim(&cid).appeal_deadline_ledger;
    env.ledger()
        .with_mut(|l| l.sequence_number = deadline + 1);
    let finalized = client.finalize_appeal(&cid);
    assert_eq!(finalized, ClaimStatus::AppealRejected);
}
