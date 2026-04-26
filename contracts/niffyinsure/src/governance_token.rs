#![cfg_attr(
    not(feature = "governance-token"),
    allow(dead_code)
)]

//! Reserved namespace for an optional **future governance token** (complement or successor
//! to tokenless DAO-style voting). This module intentionally contains **no** live
//! `token::Client` transfer/mint/burn calls — only type stubs, storage key wiring via
//! [`crate::storage::DataKey`], and gated helpers.
//!
//! ```text
//! TODO — Activation path & design prerequisites (read before enabling anything)
//! ================================================================================
//!
//! PREREQUISITES (non-exhaustive; required before any production token integration):
//!   - Final tokenomics: supply schedule, voting power mapping vs. current policy-weight
//!     voting, delegation, quorum, and upgrade authority.
//!   - Full security review of any mint/transfer paths touching treasury or claims.
//!   - Legal/compliance review if the asset is transferable or has speculative value.
//!   - Written migration plan from today’s tokenless voter registry (`Voters` / policy
//!     counts) to token-weighted or hybrid governance without breaking in-flight votes.
//!
//! INTENDED ACTIVATION SEQUENCE:
//!   1. Land storage keys + this module in a contract upgrade (feature off in production
//!      WASM) so symbol names and key layout are stable — no rename migration later.
//!   2. Build preview / audited artifacts with `--features governance-token` only in CI or
//!      staging, never as the default release profile for MVP.
//!   3. After off-chain governance approves, admin uses `gov_set_token_runtime_enabled`
//!      (compiled only with the feature) to set the runtime flag to `true`.
//!   4. Implement actual token `Client` usage **only** inside `#[cfg(feature = "governance-token")]`
//!      blocks, guarded by `governance_token_effective_enabled`, following a completed
//!      design review. Do not add transfers until that review is signed off.
//!
//! DEFAULT / MVP BUILDS (`governance-token` disabled):
//!   - `governance_token_effective_enabled` returns `false` without reading governance
//!     storage keys — zero side effects for token governance paths.
//! ```

use soroban_sdk::{contracttype, Address, Env};

use crate::storage::DataKey;

/// Minimal stub type so future exports have a stable name without pulling in token logic.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GovernanceTokenStub {
    /// Reserved; keep 0 until a design assigns semantics.
    pub reserved: u32,
}

/// Effective on-chain “armed” state for governance-token **hooks** (not implemented yet).
///
/// - Without `governance-token` feature: always `false` (**no storage read**).
/// - With feature: `true` only if admin stored `GovernanceTokenRuntimeEnabled == true`.
#[inline]
pub fn governance_token_effective_enabled(env: &Env) -> bool {
    if !cfg!(feature = "governance-token") {
        return false;
    }
    env.storage()
        .instance()
        .get::<_, bool>(&DataKey::GovernanceTokenRuntimeEnabled)
        .unwrap_or(false)
}

/// Runtime flag write — **no-op** unless `governance-token` feature is enabled.
pub fn set_governance_token_runtime_enabled(env: &Env, enabled: bool) {
    if !cfg!(feature = "governance-token") {
        return;
    }
    env.storage()
        .instance()
        .set(&DataKey::GovernanceTokenRuntimeEnabled, &enabled);
}

#[cfg(feature = "governance-token")]
pub fn get_governance_token_address(env: &Env) -> Option<Address> {
    env.storage()
        .instance()
        .get(&DataKey::GovernanceTokenAddress)
}

#[cfg(not(feature = "governance-token"))]
pub fn get_governance_token_address(_env: &Env) -> Option<Address> {
    None
}

#[cfg(feature = "governance-token")]
pub fn set_governance_token_address(env: &Env, token: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::GovernanceTokenAddress, token);
}

#[cfg(not(feature = "governance-token"))]
pub fn set_governance_token_address(_env: &Env, _token: &Address) {}

#[cfg(test)]
mod tests {
    use super::*;

    /// Default / MVP builds: feature off → always disabled (no governance storage read).
    #[cfg(not(feature = "governance-token"))]
    #[test]
    fn default_build_governance_token_inert() {
        let env = Env::default();
        assert!(!governance_token_effective_enabled(&env));
    }

    /// `set_governance_token_runtime_enabled` must not persist when the feature is off,
    /// so production MVP WASM cannot accidentally arm governance paths via storage alone.
    #[cfg(not(feature = "governance-token"))]
    #[test]
    fn set_runtime_noop_when_feature_disabled() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::NiffyInsure, ());
        env.as_contract(&contract_id, || {
            set_governance_token_runtime_enabled(&env, true);
        });
        assert!(!governance_token_effective_enabled(&env));
    }
}
// Implementation complete
