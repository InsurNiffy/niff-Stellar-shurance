#![no_std]

mod claim;
mod policy;
#[allow(dead_code)] // used by policy.rs once feat/policy-lifecycle lands
mod premium;
mod storage;
mod token;
pub mod types;
pub mod validate;

use soroban_sdk::{contract, contracterror, contractevent, contractimpl, Address, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum InitError {
    /// Contract has already been initialized; reinitialization is forbidden.
    AlreadyInitialized = 1,
}

/// Genesis event emitted once on successful initialization.
///
/// NestJS listener example:
/// ```ts
/// if (event.type === "ContractInitialized") {
///   const { version, ledger, admin } = event.data;
/// }
/// ```
#[contractevent]
pub struct ContractInitialized {
    pub version: u32,
    pub ledger: u32,
    pub admin: Address,
}

#[contract]
pub struct NiffyInsure;

#[contractimpl]
impl NiffyInsure {
    /// One-time initialization: store admin, token, zero counters, emit genesis event.
    ///
    /// # Security
    /// - `admin` must authorize this call (`require_auth`).
    /// - A persistent `Initialized` flag is set atomically; any subsequent call
    ///   returns `AlreadyInitialized` before touching any state.
    /// - `admin` may be a multisig address distinct from the transaction invoker;
    ///   Soroban auth handles both cases transparently.
    ///
    /// # Genesis event
    /// Topics : `["contract_initialized", admin]`
    /// Data   : `(version: u32, ledger: u32)`
    ///
    /// NestJS listener example:
    /// ```ts
    /// if (event.topic[0] === "contract_initialized") {
    ///   const [version, ledger] = scValToNative(event.value);
    /// }
    /// ```
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), InitError> {
        if storage::is_initialized(&env) {
            return Err(InitError::AlreadyInitialized);
        }

        // Admin must authorize — supports both EOA and multisig.
        admin.require_auth();

        // Persist state atomically before emitting the event.
        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
        // Counters default to 0 via unwrap_or — no explicit write needed.
        storage::set_initialized(&env);

        // Genesis event — parseable by NestJS without custom hacks.
        ContractInitialized {
            version: storage::CONTRACT_VERSION,
            ledger: env.ledger().sequence(),
            admin,
        }
        .publish(&env);

        Ok(())
    }

    /// Returns the stored admin address.
    pub fn get_admin(env: Env) -> Address {
        storage::get_admin(&env)
    }

    /// Pure quote path: reads config and computes premium only.
    /// This entrypoint intentionally performs no persistent writes.
    pub fn generate_premium(
        env: Env,
        policy_type: types::PolicyType,
        region: types::RegionTier,
        age: u32,
        risk_score: u32,
        include_breakdown: bool,
    ) -> Result<types::PremiumQuote, policy::QuoteError> {
        policy::generate_premium(
            &env,
            policy_type,
            region,
            age,
            risk_score,
            include_breakdown,
        )
    }

    /// Converts quote failure codes to support-friendly messages for API layers.
    pub fn quote_error_message(env: Env, code: u32) -> policy::QuoteFailure {
        let err = match code {
            1 => policy::QuoteError::InvalidAge,
            2 => policy::QuoteError::InvalidRiskScore,
            3 => policy::QuoteError::InvalidQuoteTtl,
            _ => policy::QuoteError::ArithmeticOverflow,
        };
        policy::map_quote_error(&env, err)
    }

    /// Read-only helper for monitoring state in tests / ops tooling.
    pub fn get_claim_counter(env: Env) -> u64 {
        storage::get_claim_counter(&env)
    }

    /// Read-only helper for monitoring state in tests / ops tooling.
    pub fn get_policy_counter(env: Env, holder: Address) -> u32 {
        storage::get_policy_counter(&env, &holder)
    }

    /// Read-only helper for monitoring state in tests / ops tooling.
    pub fn has_policy(env: Env, holder: Address, policy_id: u32) -> bool {
        storage::has_policy(&env, &holder, policy_id)
    }

    // ── Policy domain ────────────────────────────────────────────────────
    // initiate_policy, renew_policy, terminate_policy
    // implemented in policy.rs — issue: feat/policy-lifecycle

    // ── Claim domain ─────────────────────────────────────────────────────
    // file_claim, vote_on_claim
    // implemented in claim.rs — issue: feat/claim-voting

    // ── Admin / treasury ─────────────────────────────────────────────────
    // drain
    // implemented in token.rs — issue: feat/admin
}
