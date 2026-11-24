use soroban_sdk::{contracttype, Address, Env, Map};

use crate::types::{AgeBand, CoverageTier, MultiplierTable, RegionTier};

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
    // Absent key means not paused — never panic on missing storage.
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or_default()
}

/// Returns the stored multiplier table, falling back to the built-in default
/// when no table has been configured yet. Used by `compute` so the contract
/// always has a valid table to delegate to the shared premium engine.
pub fn get_table_or_default(env: &Env) -> MultiplierTable {
    get_table(env).unwrap_or_else(|| default_table(env))
}

/// Validates a candidate multiplier table before it is persisted.
///
/// A table is rejected when any multiplier is non-positive, when the safety
/// discount is negative, or when the version does not advance past the
/// currently stored version. Returns `Ok(())` when the table is acceptable.
pub fn validate_table(env: &Env, table: &MultiplierTable) -> Result<(), crate::errors::CalcError> {
    use crate::errors::CalcError;

    if table.safety_discount < 0 {
        return Err(CalcError::InvalidTable);
    }

    for (_, value) in table.region.iter() {
        if value <= 0 {
            return Err(CalcError::InvalidTable);
        }
    }
    for (_, value) in table.age.iter() {
        if value <= 0 {
            return Err(CalcError::InvalidTable);
        }
    }
    for (_, value) in table.coverage.iter() {
        if value <= 0 {
            return Err(CalcError::InvalidTable);
        }
    }

    if let Some(current) = get_table(env) {
        if table.version <= current.version {
            return Err(CalcError::InvalidTable);
        }
    }

    Ok(())
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
    coverage.set(CoverageTier::Basic, 9_000i128);
    coverage.set(CoverageTier::Standard, 10_000i128);
    coverage.set(CoverageTier::Premium, 13_000i128);

    MultiplierTable {
        region,
        age,
        coverage,
        safety_discount: 2_000,
        version: 1,
    }
}
