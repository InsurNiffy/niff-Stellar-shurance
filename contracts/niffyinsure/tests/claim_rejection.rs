#![cfg(test)]

use niffyinsure::{
    types::{ClaimStatus, Policy, PolicyType, RegionTier, VoteOption},
    NiffyInsureClient,
};
use soroban_sdk::{testutils::Address as _, vec as svec, Address, Env, String, Vec};

fn create_test_policy(_env: &Env, holder: &Address, policy_id: u32) -> Policy {
    Policy {
        holder: holder.clone(),
        policy_id,
        policy_type: PolicyType::Auto,
        region: RegionTier::Medium,
        premium: 1_000_000,
        coverage: 10_000_000,
        is_active: true,
        start_ledger: 100,
        end_ledger: 200,
        rejected_claims_count: 0,
        deactivation_reason: None,
    }
}

fn store_policy(env: &Env, contract_id: &Address, policy: &Policy) {
    use niffyinsure::storage::DataKey;
    env.as_contract(contract_id, || {
        env.storage().persistent().set(
            &DataKey::Policy(policy.holder.clone(), policy.policy_id),
            policy,
        );
    });
}

fn set_policy_counter(env: &Env, contract_id: &Address, holder: &Address, count: u32) {
    use niffyinsure::storage::DataKey;
    env.as_contract(contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::PolicyCounter(holder.clone()), &count);
    });
}

#[test]
fn reject_claim_increments_strike_counter() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);

    let claimant = Address::generate(&env);
    let policy = create_test_policy(&env, &claimant, 1);
    store_policy(&env, &contract_id, &policy);
    set_policy_counter(&env, &contract_id, &claimant, 1);

    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);
    store_policy(&env, &contract_id, &create_test_policy(&env, &voter1, 1));
    store_policy(&env, &contract_id, &create_test_policy(&env, &voter2, 1));
    store_policy(&env, &contract_id, &create_test_policy(&env, &voter3, 1));
    set_policy_counter(&env, &contract_id, &voter1, 1);
    set_policy_counter(&env, &contract_id, &voter2, 1);
    set_policy_counter(&env, &contract_id, &voter3, 1);

    let details = String::from_str(&env, "accident details");
    let image_urls: Vec<String> = svec![&env];
    let claim_id = client.file_claim(&claimant, &1, &5_000_000, &details, &image_urls);

    client.vote_on_claim(&voter1, &claim_id, &VoteOption::Reject);
    client.vote_on_claim(&voter2, &claim_id, &VoteOption::Reject);
    client.vote_on_claim(&voter3, &claim_id, &VoteOption::Approve);

    let claim = client.get_claim(&claim_id).unwrap();
    assert_eq!(claim.status, ClaimStatus::Rejected);

    let policy = client.get_policy(&claimant, &1).unwrap();
    assert_eq!(policy.rejected_claims_count, 1);
    assert!(policy.is_active);
}

#[test]
fn reject_claim_deactivates_policy_after_max_strikes() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);

    let claimant = Address::generate(&env);
    let mut policy = create_test_policy(&env, &claimant, 1);
    policy.rejected_claims_count = 2;
    store_policy(&env, &contract_id, &policy);
    set_policy_counter(&env, &contract_id, &claimant, 1);

    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);
    store_policy(&env, &contract_id, &create_test_policy(&env, &voter1, 1));
    store_policy(&env, &contract_id, &create_test_policy(&env, &voter2, 1));
    store_policy(&env, &contract_id, &create_test_policy(&env, &voter3, 1));
    set_policy_counter(&env, &contract_id, &voter1, 1);
    set_policy_counter(&env, &contract_id, &voter2, 1);
    set_policy_counter(&env, &contract_id, &voter3, 1);

    let details = String::from_str(&env, "third claim");
    let image_urls: Vec<String> = svec![&env];
    let claim_id = client.file_claim(&claimant, &1, &5_000_000, &details, &image_urls);

    client.vote_on_claim(&voter1, &claim_id, &VoteOption::Reject);
    client.vote_on_claim(&voter2, &claim_id, &VoteOption::Reject);
    client.vote_on_claim(&voter3, &claim_id, &VoteOption::Approve);

    let policy = client.get_policy(&claimant, &1).unwrap();
    assert_eq!(policy.rejected_claims_count, 3);
    assert!(!policy.is_active);
    assert!(policy.deactivation_reason.is_some());
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn cannot_file_claim_on_deactivated_policy() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);

    let claimant = Address::generate(&env);
    let mut policy = create_test_policy(&env, &claimant, 1);
    policy.is_active = false;
    policy.deactivation_reason = Some(String::from_str(&env, "test deactivation"));
    store_policy(&env, &contract_id, &policy);
    set_policy_counter(&env, &contract_id, &claimant, 1);

    let details = String::from_str(&env, "claim details");
    let image_urls: Vec<String> = svec![&env];
    client.file_claim(&claimant, &1, &5_000_000, &details, &image_urls);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn voter_cannot_vote_twice() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);

    let claimant = Address::generate(&env);
    let policy = create_test_policy(&env, &claimant, 1);
    store_policy(&env, &contract_id, &policy);
    set_policy_counter(&env, &contract_id, &claimant, 1);

    let voter = Address::generate(&env);
    store_policy(&env, &contract_id, &create_test_policy(&env, &voter, 1));
    set_policy_counter(&env, &contract_id, &voter, 1);

    let details = String::from_str(&env, "claim details");
    let image_urls: Vec<String> = svec![&env];
    let claim_id = client.file_claim(&claimant, &1, &5_000_000, &details, &image_urls);

    client.vote_on_claim(&voter, &claim_id, &VoteOption::Approve);
    client.vote_on_claim(&voter, &claim_id, &VoteOption::Reject);
}
