use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol};

const DAY_LEDGERS: u32 = 17_280;
const MIN_CAP: i128 = 1;
const MAX_CAP: i128 = 1_000_000_000_000_000_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Policy {
    pub holder: Address,
    pub coverage: i128,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimWindow {
    pub window_start: u32,
    pub cumulative_claimed: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimCapUpdated {
    pub cap: i128,
}

#[contract]
pub struct InsuranceContract;

#[contractimpl]
impl InsuranceContract {
    pub fn init(env: Env, admin: Address, claim_cap: i128) {
        admin.require_auth();
        env.storage().instance().set(&symbol_short!("admin"), &admin);
        Self::validate_cap(claim_cap);
        env.storage().instance().set(&symbol_short!("cap"), &claim_cap);
    }

    pub fn create_policy(env: Env, holder: Address, coverage: i128) {
        holder.require_auth();
        let policy = Policy { holder: holder.clone(), coverage, active: true };
        env.storage().persistent().set(&holder, &policy);
    }

    pub fn file_claim(env: Env, holder: Address, amount: i128) -> i128 {
        holder.require_auth();
        let mut policy: Policy = env
            .storage()
            .persistent()
            .get(&holder)
            .expect("policy not found");
        assert!(policy.active, "policy inactive");
        assert!(amount > 0, "amount must be positive");

        let cap: i128 = env.storage().instance().get(&symbol_short!("cap")).unwrap_or(0);
        let current_ledger = env.ledger().sequence();
        let window_start = (current_ledger / DAY_LEDGERS) * DAY_LEDGERS;

        let mut window: ClaimWindow = env
            .storage()
            .persistent()
            .get(&(holder.clone(), symbol_short!("win")))
            .unwrap_or(ClaimWindow { window_start, cumulative_claimed: 0 });

        if window.window_start != window_start {
            window.window_start = window_start;
            window.cumulative_claimed = 0;
        }

        let new_cumulative = window.cumulative_claimed + amount;
        assert!(new_cumulative <= cap, "rolling claim cap exceeded");
        assert!(new_cumulative <= policy.coverage, "coverage exceeded");

        window.cumulative_claimed = new_cumulative;
        env.storage()
            .persistent()
            .set(&(holder.clone(), symbol_short!("win")), &window);

        policy.coverage -= amount;
        env.storage().persistent().set(&holder, &policy);

        env.events().publish((symbol_short!("claim"), holder), amount);
        new_cumulative
    }

    pub fn set_claim_cap(env: Env, cap: i128) {
        let admin: Address = env.storage().instance().get(&symbol_short!("admin")).expect("not initialized");
        admin.require_auth();
        Self::validate_cap(cap);
        env.storage().instance().set(&symbol_short!("cap"), &cap);
        env.events().publish(
            (symbol_short!("cap_upd"),),
            ClaimCapUpdated { cap },
        );
    }

    pub fn get_claim_cap(env: Env) -> i128 {
        env.storage().instance().get(&symbol_short!("cap")).unwrap_or(0)
    }

    pub fn get_window(env: Env, holder: Address) -> Option<ClaimWindow> {
        env.storage()
            .persistent()
            .get(&(holder, symbol_short!("win")))
    }

    fn validate_cap(cap: i128) {
        assert!(cap >= MIN_CAP && cap <= MAX_CAP, "cap out of bounds");
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::Env;

    fn setup(cap: i128, coverage: i128) -> (Env, InsuranceContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, InsuranceContract);
        let client = InsuranceContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let holder = Address::generate(&env);
        client.init(&admin, &cap);
        client.create_policy(&holder, &coverage);
        (env, client, holder)
    }

    #[test]
    fn single_claim_at_cap() {
        let (_env, client, holder) = setup(100, 1_000);
        let total = client.file_claim(&holder, &100);
        assert_eq!(total, 100);
    }

    #[test]
    fn two_claims_summing_to_cap() {
        let (_env, client, holder) = setup(100, 1_000);
        client.file_claim(&holder, &60);
        let total = client.file_claim(&holder, &40);
        assert_eq!(total, 100);
    }

    #[test]
    #[should_panic(expected = "rolling claim cap exceeded")]
    fn claim_over_cap_reverts() {
        let (_env, client, holder) = setup(100, 1_000);
        client.file_claim(&holder, &101);
    }

    #[test]
    fn window_rollover_resets_cumulative() {
        let (env, client, holder) = setup(100, 1_000);
        client.file_claim(&holder, &100);
        env.ledger().with_mut(|l| l.sequence_number += DAY_LEDGERS);
        let total = client.file_claim(&holder, &100);
        assert_eq!(total, 100);
    }

    #[test]
    fn cap_change_does_not_affect_in_progress_window() {
        let (_env, client, holder) = setup(100, 1_000);
        client.file_claim(&holder, &80);
        client.set_claim_cap(&50);
        let window = client.get_window(&holder).unwrap();
        assert_eq!(window.cumulative_claimed, 80);
    }
}
