//! Commit-reveal voting: happy path + unrevealed-commit timeout behaviour.

#![cfg(test)]

use niffyinsure::{
    commit_reveal,
    types::{Claim, ClaimStatus, ClaimStatusHistoryEntry, VoteOption},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, BytesN, Env, String, Vec,
};

fn fresh() -> (Env, Address, NiffyInsureClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &Address::generate(&env));
    (env, contract_id, client)
}

fn seed_claim(env: &Env, contract_id: &Address, claim_id: u64, holder: &Address) {
    env.as_contract(contract_id, || {
        let claim = Claim {
            claim_id,
            policy_id: 1,
            claimant: holder.clone(),
            amount: 100_000,
            deductible: 0,
            asset: Address::generate(env),
            details: String::from_str(env, "cr test"),
            evidence: Vec::new(env),
            status: ClaimStatus::Processing,
            voting_deadline_ledger: 200,
            payout_deadline_ledger: 0,
            approve_votes: 0,
            reject_votes: 0,
            filed_at: 100,
            // Single eligible voter so one revealed approve meets quorum.
            eligible_voter_count: 1,
            appeal_open_deadline_ledger: 0,
            appeals_count: 0,
            appeal_deadline_ledger: 0,
            appeal_approve_votes: 0,
            appeal_reject_votes: 0,
            status_history: Vec::<ClaimStatusHistoryEntry>::new(env),
            dispute_deadline_ledger: 0,
            paid_amount: 0,
            installment_count: 0,
        };
        niffyinsure::storage::set_claim(env, &claim);
        niffyinsure::storage::set_claim_quorum_bps(env, claim_id, 1); // 0.01% — any vote meets quorum
    });
}

fn salt(env: &Env, b: u8) -> BytesN<32> {
    BytesN::from_array(env, &[b; 32])
}

#[test]
fn commit_and_reveal_happy_path_counts_approve() {
    let (env, contract_id, client) = fresh();
    let holder = Address::generate(&env);
    let voter = Address::generate(&env);
    let claim_id = 1u64;

    seed_claim(&env, &contract_id, claim_id, &holder);
    client.set_commit_reveal_phases(&claim_id, &110u32, &150u32);

    let s = salt(&env, 7);
    let commitment = commit_reveal::commitment_hash(&env, VoteOption::Approve, &s, &voter);
    client.commit_vote(&voter, &claim_id, &commitment);

    env.ledger().with_mut(|l| l.sequence_number = 120);
    client.reveal_vote(&voter, &claim_id, &VoteOption::Approve, &s);

    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.approve_votes, 1);
    assert_eq!(claim.reject_votes, 0);
    assert!(env.as_contract(&contract_id, || {
        commit_reveal::is_vote_revealed(&env, claim_id, &voter)
    }));
}

#[test]
fn unrevealed_commit_is_abstention_after_reveal_window() {
    let (env, contract_id, client) = fresh();
    let holder = Address::generate(&env);
    let revealed = Address::generate(&env);
    let silent = Address::generate(&env);
    let claim_id = 42u64;

    seed_claim(&env, &contract_id, claim_id, &holder);
    // Two eligible for docs clarity; quorum set low so one reveal still finalizes.
    env.as_contract(&contract_id, || {
        let mut c = niffyinsure::storage::get_claim(&env, claim_id).unwrap();
        c.eligible_voter_count = 2;
        niffyinsure::storage::set_claim(&env, &c);
    });

    client.set_commit_reveal_phases(&claim_id, &110u32, &150u32);

    let s_ok = salt(&env, 1);
    let s_silent = salt(&env, 2);
    let c_ok = commit_reveal::commitment_hash(&env, VoteOption::Approve, &s_ok, &revealed);
    let c_silent = commit_reveal::commitment_hash(&env, VoteOption::Reject, &s_silent, &silent);

    client.commit_vote(&revealed, &claim_id, &c_ok);
    client.commit_vote(&silent, &claim_id, &c_silent);

    env.ledger().with_mut(|l| l.sequence_number = 120);
    client.reveal_vote(&revealed, &claim_id, &VoteOption::Approve, &s_ok);

    env.ledger().with_mut(|l| l.sequence_number = 151);
    let late = client.try_reveal_vote(&silent, &claim_id, &VoteOption::Reject, &s_silent);
    assert!(late.is_err());

    env.as_contract(&contract_id, || {
        assert!(commit_reveal::has_commitment(&env, claim_id, &silent));
        assert!(commit_reveal::is_unrevealed_commit(&env, claim_id, &silent));
        assert!(!commit_reveal::is_vote_revealed(&env, claim_id, &silent));
        assert!(commit_reveal::is_vote_revealed(&env, claim_id, &revealed));
    });

    let claim = client.get_claim(&claim_id);
    // Only the revealed Approve counts — silent Reject commit is excluded from tally.
    assert_eq!(claim.approve_votes, 1);
    assert_eq!(claim.reject_votes, 0);

    env.ledger().with_mut(|l| l.sequence_number = 201);
    let status = client.finalize_claim(&claim_id);
    assert_eq!(status, ClaimStatus::Approved);
}

#[test]
fn phases_required_for_commit() {
    let (_env, _contract_id, client) = fresh();
    let voter = Address::generate(&_env);
    let commitment = BytesN::from_array(&_env, &[9u8; 32]);
    assert!(client.try_commit_vote(&voter, &1u64, &commitment).is_err());
}

#[test]
fn reveal_with_wrong_vote_fails_commitment_mismatch() {
    let (env, contract_id, client) = fresh();
    let holder = Address::generate(&env);
    let voter = Address::generate(&env);
    let claim_id = 10u64;

    seed_claim(&env, &contract_id, claim_id, &holder);
    client.set_commit_reveal_phases(&claim_id, &110u32, &150u32);

    let s = salt(&env, 5);
    // commit Approve, try to reveal Reject
    let commitment = commit_reveal::commitment_hash(&env, VoteOption::Approve, &s, &voter);
    client.commit_vote(&voter, &claim_id, &commitment);

    env.ledger().with_mut(|l| l.sequence_number = 120);
    let result = client.try_reveal_vote(&voter, &claim_id, &VoteOption::Reject, &s);
    assert!(result.is_err(), "wrong vote must fail CommitmentMismatch");
}

#[test]
fn reveal_after_reveal_phase_end_fails() {
    let (env, contract_id, client) = fresh();
    let holder = Address::generate(&env);
    let voter = Address::generate(&env);
    let claim_id = 11u64;

    seed_claim(&env, &contract_id, claim_id, &holder);
    client.set_commit_reveal_phases(&claim_id, &110u32, &150u32);

    let s = salt(&env, 3);
    let commitment = commit_reveal::commitment_hash(&env, VoteOption::Approve, &s, &voter);
    client.commit_vote(&voter, &claim_id, &commitment);

    // Advance past reveal window
    env.ledger().with_mut(|l| l.sequence_number = 151);
    let result = client.try_reveal_vote(&voter, &claim_id, &VoteOption::Approve, &s);
    assert!(result.is_err(), "reveal after window must fail RevealPhaseEnded");
}

#[test]
fn copied_commitment_fails_for_other_voter() {
    // A commitment made by `voter_a` cannot be replayed for `voter_b`
    // because the voter address is bound into the hash preimage.
    let (env, contract_id, client) = fresh();
    let holder = Address::generate(&env);
    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);
    let claim_id = 12u64;

    seed_claim(&env, &contract_id, claim_id, &holder);
    client.set_commit_reveal_phases(&claim_id, &110u32, &150u32);

    let s = salt(&env, 9);
    // voter_a builds commitment including their own address
    let commitment_a = commit_reveal::commitment_hash(&env, VoteOption::Approve, &s, &voter_a);

    // voter_b submits voter_a's commitment (copied)
    client.commit_vote(&voter_b, &claim_id, &commitment_a);

    env.ledger().with_mut(|l| l.sequence_number = 120);
    // voter_b tries to reveal with the correct vote/salt but their own address won't match
    let result = client.try_reveal_vote(&voter_b, &claim_id, &VoteOption::Approve, &s);
    assert!(result.is_err(), "copied commitment must fail CommitmentMismatch for other voter");
}

#[test]
fn tally_correct_after_mixed_reveals() {
    let (env, contract_id, client) = fresh();
    let holder = Address::generate(&env);
    let voter_approve = Address::generate(&env);
    let voter_reject = Address::generate(&env);
    let claim_id = 13u64;

    seed_claim(&env, &contract_id, claim_id, &holder);
    env.as_contract(&contract_id, || {
        let mut c = niffyinsure::storage::get_claim(&env, claim_id).unwrap();
        c.eligible_voter_count = 2;
        niffyinsure::storage::set_claim(&env, &c);
    });

    client.set_commit_reveal_phases(&claim_id, &110u32, &200u32);

    let s_a = salt(&env, 11);
    let s_r = salt(&env, 22);
    let c_a = commit_reveal::commitment_hash(&env, VoteOption::Approve, &s_a, &voter_approve);
    let c_r = commit_reveal::commitment_hash(&env, VoteOption::Reject, &s_r, &voter_reject);

    client.commit_vote(&voter_approve, &claim_id, &c_a);
    client.commit_vote(&voter_reject, &claim_id, &c_r);

    env.ledger().with_mut(|l| l.sequence_number = 120);
    client.reveal_vote(&voter_approve, &claim_id, &VoteOption::Approve, &s_a);
    client.reveal_vote(&voter_reject, &claim_id, &VoteOption::Reject, &s_r);

    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.approve_votes, 1);
    assert_eq!(claim.reject_votes, 1);
}
