//! #1434 — Policy read APIs: bounded pagination stability and instruction budget.

#![cfg(test)]

use niffyinsure::types::{PAGE_SIZE_MAX, POLICY_BATCH_GET_MAX, PolicyLookupKey};
use niffyinsure::NiffyInsureClient;
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

fn setup() -> (Env, NiffyInsureClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client)
}

fn seed_n(client: &NiffyInsureClient<'_>, holder: &Address, n: u32) {
    for i in 1..=n {
        client.test_seed_policy(holder, &i, &1_000_000i128, &100_000u32);
    }
}

#[test]
fn list_policies_clamps_limit_silently() {
    let (env, client) = setup();
    let holder = Address::generate(&env);
    seed_n(&client, &holder, PAGE_SIZE_MAX + 5);

    let page = client.list_policies(&holder, &0u32, &(PAGE_SIZE_MAX + 50));
    assert_eq!(page.len(), PAGE_SIZE_MAX);
}

#[test]
fn list_policies_pagination_stable_no_gaps_or_duplicates() {
    let (env, client) = setup();
    let holder = Address::generate(&env);
    let total = PAGE_SIZE_MAX + 7; // 27 policies → 2 full pages + remainder
    seed_n(&client, &holder, total);

    let mut seen: Vec<u32> = Vec::new(&env);
    let mut cursor = 0u32;
    loop {
        let page = client.list_policies(&holder, &cursor, &PAGE_SIZE_MAX);
        if page.len() == 0 {
            break;
        }
        for i in 0..page.len() {
            let id = page.get(i).unwrap().policy_id;
            // Ascending, no duplicates.
            if seen.len() > 0 {
                let prev = seen.get(seen.len() - 1).unwrap();
                assert!(id > prev, "policy_ids must be strictly ascending across pages");
            }
            seen.push_back(id);
            cursor = id;
        }
    }
    assert_eq!(seen.len(), total, "pagination must cover every policy exactly once");
    for i in 0..total {
        assert_eq!(seen.get(i).unwrap(), i + 1);
    }
}

#[test]
fn get_policies_batch_preserves_input_order() {
    let (env, client) = setup();
    let holder = Address::generate(&env);
    seed_n(&client, &holder, 5);

    let mut ids = Vec::new(&env);
    // Deliberately non-monotonic input order.
    for id in [3u32, 1, 5, 2, 4] {
        ids.push_back(PolicyLookupKey {
            holder: holder.clone(),
            policy_id: id,
        });
    }
    let out = client.get_policies_batch(&ids);
    assert_eq!(out.len(), 5u32);
    assert_eq!(out.get(0).unwrap().as_ref().unwrap().policy_id, 3);
    assert_eq!(out.get(1).unwrap().as_ref().unwrap().policy_id, 1);
    assert_eq!(out.get(2).unwrap().as_ref().unwrap().policy_id, 5);
    assert_eq!(out.get(3).unwrap().as_ref().unwrap().policy_id, 2);
    assert_eq!(out.get(4).unwrap().as_ref().unwrap().policy_id, 4);
}

#[test]
fn instruction_budget_at_page_size_max_fits_simulation() {
    let (env, client) = setup();
    let holder = Address::generate(&env);
    seed_n(&client, &holder, PAGE_SIZE_MAX);

    // list_policies at max page size.
    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let page = client.list_policies(&holder, &0u32, &PAGE_SIZE_MAX);
    let after_list = env.cost_estimate().budget().cpu_instruction_cost();
    assert_eq!(page.len(), PAGE_SIZE_MAX);
    let list_cost = after_list - before;
    // Default Soroban simulation budget is well above 100M; keep a conservative ceiling.
    assert!(
        list_cost < 50_000_000,
        "list_policies at PAGE_SIZE_MAX burned {list_cost} CPU instructions"
    );

    let mut ids = Vec::new(&env);
    for i in 1..=POLICY_BATCH_GET_MAX {
        ids.push_back(PolicyLookupKey {
            holder: holder.clone(),
            policy_id: i,
        });
    }
    let before_b = env.cost_estimate().budget().cpu_instruction_cost();
    let batch = client.get_policies_batch(&ids);
    let after_b = env.cost_estimate().budget().cpu_instruction_cost();
    assert_eq!(batch.len(), POLICY_BATCH_GET_MAX);
    let batch_cost = after_b - before_b;
    assert!(
        batch_cost < 50_000_000,
        "get_policies_batch at max burned {batch_cost} CPU instructions"
    );
}

#[test]
fn read_apis_expose_counters_and_nonce() {
    let (env, client) = setup();
    let holder = Address::generate(&env);
    assert_eq!(client.get_policy_counter(&holder), 0u32);
    assert!(!client.has_policy(&holder, &1u32));
    assert_eq!(client.get_active_policy_count(&holder), 0u32);
    assert_eq!(client.holder_active_policy_count(&holder), 0u32);
    assert_eq!(client.get_nonce(&holder), 0u64);
    let inactive = client.get_inactive_policies(&holder, &0u32, &10u32);
    assert_eq!(inactive.len(), 0u32);

    seed_n(&client, &holder, 2);
    assert_eq!(client.get_policy_counter(&holder), 2u32);
    assert!(client.has_policy(&holder, &1u32));
    assert_eq!(client.get_active_policy_count(&holder), 2u32);
}
