use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol};

const BPS_DENOMINATOR: u32 = 10_000;
const MAX_PROTOCOL_FEE_BPS: u32 = 2_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub min_solvency_ratio_bps: u32,
    pub min_coverage_amount: i128,
    pub protocol_fee_bps: u32,
    pub fee_recipient: Address,
    pub total_coverage: i128,
    pub treasury_balance: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigUpdated {
    pub min_solvency_ratio_bps: u32,
    pub min_coverage_amount: i128,
    pub protocol_fee_bps: u32,
    pub fee_recipient: Address,
}

fn config_key() -> Symbol {
    symbol_short!("CONFIG")
}

fn load_config(env: &Env) -> Config {
    env.storage().instance().get(&config_key()).unwrap()
}

fn save_config(env: &Env, config: &Config) {
    env.storage().instance().set(&config_key(), config);
}

fn emit_config_updated(env: &Env, config: &Config) {
    env.events().publish(
        (symbol_short!("ConfigUpdated"),),
        ConfigUpdated {
            min_solvency_ratio_bps: config.min_solvency_ratio_bps,
            min_coverage_amount: config.min_coverage_amount,
            protocol_fee_bps: config.protocol_fee_bps,
            fee_recipient: config.fee_recipient.clone(),
        },
    );
}

#[contract]
pub struct C20Contract;

#[contractimpl]
impl C20Contract {
    pub fn initialize(
        env: Env,
        admin: Address,
        min_solvency_ratio_bps: u32,
        min_coverage_amount: i128,
        protocol_fee_bps: u32,
        fee_recipient: Address,
    ) {
        admin.require_auth();
        if protocol_fee_bps > MAX_PROTOCOL_FEE_BPS {
            panic!("protocol fee exceeds cap");
        }
        let config = Config {
            min_solvency_ratio_bps,
            min_coverage_amount,
            protocol_fee_bps,
            fee_recipient,
            total_coverage: 0,
            treasury_balance: 0,
        };
        save_config(&env, &config);
        emit_config_updated(&env, &config);
    }

    pub fn admin_set_min_solvency_ratio_bps(env: Env, admin: Address, bps: u32) {
        admin.require_auth();
        let mut config = load_config(&env);
        config.min_solvency_ratio_bps = bps;
        save_config(&env, &config);
        emit_config_updated(&env, &config);
    }

    pub fn get_min_solvency_ratio_bps(env: Env) -> u32 {
        load_config(&env).min_solvency_ratio_bps
    }

    pub fn check_solvency_ratio(env: Env, new_coverage: i128) -> bool {
        let config = load_config(&env);
        let projected_coverage = config.total_coverage + new_coverage;
        if projected_coverage <= 0 {
            return true;
        }
        let required = projected_coverage
            .checked_mul(config.min_solvency_ratio_bps as i128)
            .expect("overflow")
            / (BPS_DENOMINATOR as i128);
        config.treasury_balance >= required
    }

    pub fn admin_set_min_coverage_amount(env: Env, admin: Address, amount: i128) {
        admin.require_auth();
        let mut config = load_config(&env);
        config.min_coverage_amount = amount;
        save_config(&env, &config);
        emit_config_updated(&env, &config);
    }

    pub fn admin_set_protocol_fee_bps(env: Env, admin: Address, bps: u32) {
        admin.require_auth();
        if bps > MAX_PROTOCOL_FEE_BPS {
            panic!("protocol fee exceeds cap");
        }
        let mut config = load_config(&env);
        config.protocol_fee_bps = bps;
        save_config(&env, &config);
        emit_config_updated(&env, &config);
    }

    pub fn admin_set_fee_recipient(env: Env, admin: Address, recipient: Address) {
        admin.require_auth();
        let mut config = load_config(&env);
        config.fee_recipient = recipient;
        save_config(&env, &config);
        emit_config_updated(&env, &config);
    }

    pub fn split_premium(env: Env, amount: i128) -> (i128, i128) {
        if amount < 0 {
            panic!("amount must be non-negative");
        }
        let config = load_config(&env);
        let fee = amount
            .checked_mul(config.protocol_fee_bps as i128)
            .expect("overflow")
            / (BPS_DENOMINATOR as i128);
        let to_treasury = amount - fee;
        (to_treasury, fee)
    }
}
