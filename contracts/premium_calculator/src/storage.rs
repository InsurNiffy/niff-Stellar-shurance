use soroban_sdk::{contracttype, Address, Env, Map};

use crate::types::{AgeBand, CoverageType, MultiplierTable, RegionTier};

#[contracttype]
pub enum DataKey {
    Admin,
    PremiumTable,
    Paused,
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_table(env: &Env, table: &MultiplierTable) {
    env.storage().instance().set(&DataKey::PremiumTable, table);
}

pub fn get_table(env: &Env) -> Option<MultiplierTable> {
    env.storage().instance().get(&DataKey::PremiumTable)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::Paused, &paused);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

pub fn default_table(env: &Env) -> MultiplierTable {
    let mut region = Map::new(env);
    region.set(RegionTier::Low, 8_500i128);
    region.set(RegionTier::Medium, 10_000i128);
    region.set(RegionTier::High, 13_500i128);

    let mut age = Map::new(env);
    age.set(AgeBand::Young, 12_500i128);
    age.set(AgeBand::Adult, 10_000i128);
    age.set(AgeBand::Senior, 11_500i128);

    let mut coverage = Map::new(env);
    coverage.set(CoverageType::Basic, 9_000i128);
    coverage.set(CoverageType::Standard, 10_000i128);
    coverage.set(CoverageType::Premium, 13_000i128);

    MultiplierTable {
        region,
        age,
        coverage,
        safety_discount: 2_000,
        version: 1,
    }
}
