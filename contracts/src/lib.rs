#![no_std]

mod governance_token;
#[cfg(feature = "experimental")]
mod oracle;
mod vet;

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, String, Symbol, Vec};

pub use governance_token::{GovernanceTokenKey, GovernanceTokenStub};
#[cfg(feature = "experimental")]
pub use oracle::{OracleTrigger, OracleTriggerResult};
pub use vet::VetRecord;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    VetNotFound = 1,
    ClaimNotFound = 2,
    InvalidTable = 3,
    TableNotFound = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Claim {
    pub id: u64,
    pub claimant: Address,
    pub amount: i128,
    pub required_specialization: Option<String>,
}

/// A multiplier table: a list of basis-point multipliers applied to premiums.
/// Each entry must be a positive value; the table must be non-empty.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultiplierTable {
    pub multipliers: Vec<i128>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Claim(u64),
    ClaimCounter,
    GlobalMultiplierTable,
    AssetMultiplierTable(Address),
    TableVersion,
}

#[contract]
pub struct ClaimsContract;

/// Validate a multiplier table before storing it.
fn validate_table(table: &MultiplierTable) -> Result<(), ContractError> {
    if table.multipliers.is_empty() {
        return Err(ContractError::InvalidTable);
    }
    for m in table.multipliers.iter() {
        if m <= 0 {
            return Err(ContractError::InvalidTable);
        }
    }
    Ok(())
}

fn bump_version(env: &Env) -> u64 {
    let version: u64 = env
        .storage()
        .persistent()
        .get(&DataKey::TableVersion)
        .unwrap_or(0);
    let next = version + 1;
    env.storage().persistent().set(&DataKey::TableVersion, &next);
    env.events()
        .publish((Symbol::new(env, "MultiplierTableUpdated"),), next);
    next
}

#[contractimpl]
impl ClaimsContract {
    /// Register a vet with specializations.
    pub fn register_vet(env: Env, vet: Address, specializations: Vec<String>) {
        vet::register_vet(&env, &vet, specializations);
    }

    /// Returns the specializations of a registered vet.
    pub fn vet_specializations(env: Env, vet: Address) -> Option<Vec<String>> {
        vet::vet_specializations(&env, &vet)
    }

    /// File a claim. If `required_specialization` is set, an active registered
    /// vet with that specialization must exist, otherwise `VetNotFound` is returned.
    pub fn file_claim(
        env: Env,
        claimant: Address,
        amount: i128,
        required_specialization: Option<String>,
    ) -> Result<u64, ContractError> {
        claimant.require_auth();

        if let Some(ref spec) = required_specialization {
            if !vet::has_vet_with_specialization(&env, spec) {
                return Err(ContractError::VetNotFound);
            }
        }

        let counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ClaimCounter)
            .unwrap_or(0);
        let id = counter + 1;
        let claim = Claim {
            id,
            claimant,
            amount,
            required_specialization,
        };
        env.storage().persistent().set(&DataKey::Claim(id), &claim);
        env.storage().persistent().set(&DataKey::ClaimCounter, &id);
        Ok(id)
    }

    /// Fetch a claim by id.
    pub fn get_claim(env: Env, id: u64) -> Result<Claim, ContractError> {
        env.storage()
            .persistent()
            .get(&DataKey::Claim(id))
            .ok_or(ContractError::ClaimNotFound)
    }

    /// Admin: replace the global multiplier table. Validated before storing.
    pub fn update_multiplier_table(
        env: Env,
        admin: Address,
        table: MultiplierTable,
    ) -> Result<u64, ContractError> {
        admin.require_auth();
        validate_table(&table)?;
        env.storage()
            .persistent()
            .set(&DataKey::GlobalMultiplierTable, &table);
        Ok(bump_version(&env))
    }

    /// Returns the current global multiplier table.
    pub fn get_multiplier_table(env: Env) -> Result<MultiplierTable, ContractError> {
        env.storage()
            .persistent()
            .get(&DataKey::GlobalMultiplierTable)
            .ok_or(ContractError::TableNotFound)
    }

    /// Admin: tune a single premium multiplier in the global table.
    pub fn admin_set_premium_multiplier(
        env: Env,
        admin: Address,
        index: u32,
        multiplier: i128,
    ) -> Result<u64, ContractError> {
        admin.require_auth();
        if multiplier <= 0 {
            return Err(ContractError::InvalidTable);
        }
        let mut table: MultiplierTable = env
            .storage()
            .persistent()
            .get(&DataKey::GlobalMultiplierTable)
            .ok_or(ContractError::TableNotFound)?;
        if index >= table.multipliers.len() {
            return Err(ContractError::InvalidTable);
        }
        table.multipliers.set(index, multiplier);
        validate_table(&table)?;
        env.storage()
            .persistent()
            .set(&DataKey::GlobalMultiplierTable, &table);
        Ok(bump_version(&env))
    }

    /// Admin: set a per-asset multiplier table that overrides the global table.
    pub fn admin_set_asset_premium_table(
        env: Env,
        admin: Address,
        asset: Address,
        table: MultiplierTable,
    ) -> Result<u64, ContractError> {
        admin.require_auth();
        validate_table(&table)?;
        env.storage()
            .persistent()
            .set(&DataKey::AssetMultiplierTable(asset), &table);
        Ok(bump_version(&env))
    }

    /// Returns the effective multiplier table for an asset: the per-asset table
    /// when present, otherwise the global table.
    pub fn get_asset_premium_table(
        env: Env,
        asset: Address,
    ) -> Result<MultiplierTable, ContractError> {
        if let Some(table) = env
            .storage()
            .persistent()
            .get(&DataKey::AssetMultiplierTable(asset))
        {
            return Ok(table);
        }
        env.storage()
            .persistent()
            .get(&DataKey::GlobalMultiplierTable)
            .ok_or(ContractError::TableNotFound)
    }

    /// Query an oracle parametric trigger. Only available with `--features experimental`.
    ///
    /// Default builds panic with `ORACLE_TRIGGERS_DISABLED`.
    pub fn query_trigger(env: Env, trigger_id: u64) -> OracleTriggerResult {
        #[cfg(feature = "experimental")]
        {
            oracle::query_trigger(&env, trigger_id)
        }
        #[cfg(not(feature = "experimental"))]
        {
            let _ = (env, trigger_id);
            panic!("ORACLE_TRIGGERS_DISABLED")
        }
    }

    /// Validate an oracle parametric trigger. Only available with `--features experimental`.
    ///
    /// Default builds panic with `ORACLE_TRIGGERS_DISABLED`.
    pub fn validate_trigger(env: Env, trigger_id: u64) -> bool {
        #[cfg(feature = "experimental")]
        {
            oracle::validate_trigger(&env, trigger_id)
        }
        #[cfg(not(feature = "experimental"))]
        {
            let _ = (env, trigger_id);
            panic!("ORACLE_TRIGGERS_DISABLED")
        }
    }

    /// Execute an oracle parametric trigger. Only available with `--features experimental`.
    ///
    /// Default builds panic with `ORACLE_TRIGGERS_DISABLED`.
    pub fn execute_trigger(env: Env, trigger_id: u64) -> OracleTriggerResult {
        #[cfg(feature = "experimental")]
        {
            oracle::execute_trigger(&env, trigger_id)
        }
        #[cfg(not(feature = "experimental"))]
        {
            let _ = (env, trigger_id);
            panic!("ORACLE_TRIGGERS_DISABLED")
        }
    }
}

#[cfg(test)]
mod governance_token_tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn default_build_has_no_token_side_effects() {
        let env = Env::default();
        let contract_id = env.register_contract(None, ClaimsContract);
        let client = ClaimsContractClient::new(&env, &contract_id);

        let claimant = Address::generate(&env);
        env.mock_all_auths();
        let id = client.file_claim(&claimant, &100i128, &None);
        assert_eq!(id, 1);

        // No governance token storage keys should be written in default builds.
        assert!(!governance_token::is_activated(&env));
        assert_eq!(governance_token::total_supply(&env), 0);
    }
}
