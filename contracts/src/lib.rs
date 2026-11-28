#![no_std]

mod vet;

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, String, Symbol, Vec};

pub use vet::VetRecord;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    VetNotFound = 1,
    ClaimNotFound = 2,
}

/// Errors returned by the read-only quote entrypoints.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum QuoteError {
    /// Coverage is below the configured `min_coverage_amount`.
    CoverageBelowMinimum = 1,
    /// Coverage exceeds the asset's maximum insurable amount.
    CoverageAboveAssetMax = 2,
    /// Asset is not registered / has no bounds configured.
    AssetNotSupported = 3,
    /// Policy type is not present in the policy type registry.
    UnknownPolicyType = 4,
    /// Premium input amount is not positive.
    InvalidPremiumInput = 5,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Claim {
    pub id: u64,
    pub claimant: Address,
    pub amount: i128,
    pub required_specialization: Option<String>,
}

/// Result of a read-only premium quote.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QuoteResult {
    pub premium: i128,
    pub coverage: i128,
    pub asset: Symbol,
    pub table_version: u32,
    pub calc_source: Symbol,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Claim(u64),
    ClaimCounter,
    MinCoverageAmount,
    AssetMax(Symbol),
    PolicyType(Symbol),
    TableVersion,
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

    /// Read-only quote for the default asset. See `generate_premium_for_asset`.
    pub fn generate_premium(
        env: Env,
        input: i128,
        coverage: i128,
    ) -> Result<QuoteResult, QuoteError> {
        let asset = Symbol::new(&env, "default");
        Self::generate_premium_for_asset(env, input, coverage, asset)
    }

    /// Read-only quote entrypoint. Validates coverage against the configured
    /// minimum, the asset bounds, and the policy type registry, then returns a
    /// `QuoteResult`. Performs no storage writes.
    pub fn generate_premium_for_asset(
        env: Env,
        input: i128,
        coverage: i128,
        asset: Symbol,
    ) -> Result<QuoteResult, QuoteError> {
        if input <= 0 {
            return Err(QuoteError::InvalidPremiumInput);
        }

        let min_coverage: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::MinCoverageAmount)
            .unwrap_or(0);
        if coverage < min_coverage {
            return Err(QuoteError::CoverageBelowMinimum);
        }

        let asset_max: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::AssetMax(asset.clone()))
            .ok_or(QuoteError::AssetNotSupported)?;
        if coverage > asset_max {
            return Err(QuoteError::CoverageAboveAssetMax);
        }

        if !env
            .storage()
            .persistent()
            .has(&DataKey::PolicyType(asset.clone()))
        {
            return Err(QuoteError::UnknownPolicyType);
        }

        let table_version: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::TableVersion)
            .unwrap_or(1);

        // Simple linear premium: input scaled by coverage ratio against asset max.
        let premium = input + (input * coverage) / asset_max;

        Ok(QuoteResult {
            premium,
            coverage,
            asset,
            table_version,
            calc_source: Symbol::new(&env, "linear"),
        })
    }

    /// Static lookup mapping a quote error code to a human-readable message.
    /// Performs no storage writes.
    pub fn quote_error_message(env: Env, code: u32) -> String {
        let msg = match code {
            1 => "coverage below minimum",
            2 => "coverage above asset maximum",
            3 => "asset not supported",
            4 => "unknown policy type",
            5 => "invalid premium input",
            _ => "unknown quote error",
        };
        String::from_str(&env, msg)
    }
}
