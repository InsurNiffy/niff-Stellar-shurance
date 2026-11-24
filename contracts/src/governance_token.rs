//! # Governance Token Stub (C-33 Contract)
//!
//! This module reserves the namespace, storage keys, and type surface for a
//! future governance token. **No live token logic is active in default builds.**
//!
//! ## Activation path (TODO)
//!
//! TODO(governance-token): To activate the governance token:
//!   1. Enable the `governance-token` Cargo feature on the contract crate.
//!   2. Implement the real logic inside the `#[cfg(feature = "governance-token")]`
//!      blocks below (mint, transfer, balance, allowance, delegation).
//!   3. Wire the module into `lib.rs` behind the same feature gate so the
//!      exported entry points only exist in feature-flagged builds.
//!   4. Add migration logic for the reserved storage keys before enabling the
//!      feature on any deployed instance.
//!   5. Audit the token economics and access control before mainnet activation.
//!
//! Until then, every function here is a no-op stub that performs zero token
//! operations, and the storage keys are reserved but never written.

use soroban_sdk::{contracttype, Address, Env};

/// Reserved storage keys for the future governance token.
///
/// These variants are declared so the namespace is reserved, but they are not
/// written to storage in default builds.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GovernanceTokenKey {
    /// Token metadata (name, symbol, decimals).
    Metadata,
    /// Total supply of the governance token.
    TotalSupply,
    /// Per-account balance.
    Balance(Address),
    /// Per-account allowance: (owner, spender).
    Allowance(Address, Address),
    /// Per-account delegation target.
    Delegate(Address),
}

/// Stub token metadata type reserved for the future governance token.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenMetadata {
    pub name: soroban_sdk::String,
    pub symbol: soroban_sdk::String,
    pub decimals: u32,
}

/// Stub balance record reserved for the future governance token.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenBalance {
    pub owner: Address,
    pub amount: i128,
}

/// Returns the reserved storage key for token metadata.
///
/// In default builds this only constructs the key; it never touches storage.
pub fn metadata_key() -> GovernanceTokenKey {
    GovernanceTokenKey::Metadata
}

/// Returns the reserved storage key for the total supply.
pub fn total_supply_key() -> GovernanceTokenKey {
    GovernanceTokenKey::TotalSupply
}

/// Returns the reserved storage key for an account balance.
pub fn balance_key(owner: &Address) -> GovernanceTokenKey {
    GovernanceTokenKey::Balance(owner.clone())
}

/// Stub: returns the balance for `owner`.
///
/// Default builds perform no token operations and always return `0`.
pub fn balance(_env: &Env, _owner: &Address) -> i128 {
    0
}

/// Stub: returns the total supply.
///
/// Default builds perform no token operations and always return `0`.
pub fn total_supply(_env: &Env) -> i128 {
    0
}

/// Stub: transfers tokens between accounts.
///
/// Default builds perform no token operations and always return `false`.
pub fn transfer(_env: &Env, _from: &Address, _to: &Address, _amount: i128) -> bool {
    false
}

/// Stub: approves a spender allowance.
///
/// Default builds perform no token operations and always return `false`.
pub fn approve(_env: &Env, _owner: &Address, _spender: &Address, _amount: i128) -> bool {
    false
}

/// Stub: delegates voting power to `delegate`.
///
/// Default builds perform no token operations and always return `false`.
pub fn delegate(_env: &Env, _owner: &Address, _delegate: &Address) -> bool {
    false
}

#[cfg(feature = "governance-token")]
mod active {
    //! Live governance token logic, gated behind the `governance-token` feature.
    //!
    //! TODO(governance-token): Implement the real token logic here. This module
    //! is intentionally empty until the feature is activated per the activation
    //! path documented at the top of this file.
    use super::*;

    /// Feature-gated placeholder for the live balance lookup.
    pub fn balance(_env: &Env, _owner: &Address) -> i128 {
        // TODO(governance-token): read from `GovernanceTokenKey::Balance`.
        0
    }

    /// Feature-gated placeholder for the live total supply lookup.
    pub fn total_supply(_env: &Env) -> i128 {
        // TODO(governance-token): read from `GovernanceTokenKey::TotalSupply`.
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn default_build_has_no_token_side_effects() {
        let env = Env::default();
        let owner = Address::generate(&env);
        let other = Address::generate(&env);

        // Stub operations must never mutate state or report success.
        assert_eq!(balance(&env, &owner), 0);
        assert_eq!(total_supply(&env), 0);
        assert!(!transfer(&env, &owner, &other, 100));
        assert!(!approve(&env, &owner, &other, 100));
        assert!(!delegate(&env, &owner, &other));
    }

    #[test]
    fn reserved_keys_are_constructible_without_storage_writes() {
        let env = Env::default();
        let owner = Address::generate(&env);

        assert_eq!(metadata_key(), GovernanceTokenKey::Metadata);
        assert_eq!(total_supply_key(), GovernanceTokenKey::TotalSupply);
        assert_eq!(balance_key(&owner), GovernanceTokenKey::Balance(owner.clone()));
    }

    #[test]
    fn stub_operations_do_not_persist_balances() {
        let env = Env::default();
        let owner = Address::generate(&env);
        let other = Address::generate(&env);

        // Even after a (stubbed) transfer, balances remain zero.
        let _ = transfer(&env, &owner, &other, 500);
        assert_eq!(balance(&env, &owner), 0);
        assert_eq!(balance(&env, &other), 0);
    }
}
