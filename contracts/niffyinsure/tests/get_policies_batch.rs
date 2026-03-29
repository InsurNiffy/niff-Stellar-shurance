#![cfg(test)]

use niffyinsure::{validate::Error as ValidateError, NiffyInsureClient};
use niffyinsure::types::{PolicyLookupKey, POLICY_BATCH_GET_MAX};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

#[test]
fn get_policies_batch_empty_input() {
    let (env, client, _, _) = setup();
    let ids = Vec::new(&env);
    let out = client.get_policies_batch(&ids);
    assert_eq!(out.len(), 0u32);
}

#[test]
fn get_policies_batch_full_batch_all_hits() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    for i in 1..=POLICY_BATCH_GET_MAX {
        client.test_seed_policy(&holder, &i, &1_000_000i128, &10_000u32);
    }
    let mut ids = Vec::new(&env);
    for i in 1..=POLICY_BATCH_GET_MAX {
        ids.push_back(PolicyLookupKey {
            holder: holder.clone(),
            policy_id: i,
        });
    }
    let out = client.get_policies_batch(&ids);
    assert_eq!(out.len(), POLICY_BATCH_GET_MAX);
    for i in 0..POLICY_BATCH_GET_MAX {
        let p = out.get(i).unwrap().unwrap();
        assert_eq!(p.policy_id, i + 1);
        assert_eq!(p.holder, holder);
        assert_eq!(p.asset, token);
    }
}

#[test]
fn get_policies_batch_partial_hits_mixed_none_positions() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    client.test_seed_policy(&holder, &1u32, &500_000i128, &5_000u32);
    client.test_seed_policy(&holder, &3u32, &700_000i128, &6_000u32);

    let mut ids = Vec::new(&env);
    ids.push_back(PolicyLookupKey {
        holder: holder.clone(),
        policy_id: 1,
    });
    ids.push_back(PolicyLookupKey {
        holder: holder.clone(),
        policy_id: 2,
    });
    ids.push_back(PolicyLookupKey {
        holder: holder.clone(),
        policy_id: 3,
    });

    let out = client.get_policies_batch(&ids);
    assert_eq!(out.len(), 3u32);
    assert!(out.get(0u32).unwrap().is_some());
    assert!(out.get(1u32).unwrap().is_none());
    assert!(out.get(2u32).unwrap().is_some());
    assert_eq!(out.get(0u32).unwrap().as_ref().unwrap().policy_id, 1);
    assert_eq!(out.get(2u32).unwrap().as_ref().unwrap().policy_id, 3);
}

#[test]
fn get_policies_batch_over_cap_reverts() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let mut ids = Vec::new(&env);
    for i in 0..=(POLICY_BATCH_GET_MAX as usize) {
        ids.push_back(PolicyLookupKey {
            holder: holder.clone(),
            policy_id: i as u32,
        });
    }
    let err = client.try_get_policies_batch(&ids).err().unwrap().unwrap();
    assert_eq!(err, ValidateError::VotingDurationOutOfBounds.into());
}
