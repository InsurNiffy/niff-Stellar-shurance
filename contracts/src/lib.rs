#![no_std]

mod vet;

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, String, Vec};

pub use vet::VetRecord;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    VetNotFound = 1,
    ClaimNotFound = 2,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Claim {
    pub id: u64,
    pub claimant: Address,
    pub amount: i128,
    pub required_specialization: Option<String>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Claim(u64),
    ClaimCounter,
}

#[contract]
pub struct ClaimsContract;

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
}
