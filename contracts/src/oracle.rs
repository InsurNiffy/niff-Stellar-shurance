//! C-34 Contract — Oracle integration stub: parametric trigger scaffolding.
//!
//! This module provides scaffolding for future parametric-trigger integration.
//! It is compiled only under `--features experimental`.
//!
//! # Safety
//!
//! Default builds (without `--features experimental`) cannot execute oracle
//! triggers: every entrypoint panics with `ORACLE_TRIGGERS_DISABLED`.
//!
//! # Activation prerequisites
//!
//! Production oracle activation requires, at minimum:
//!
//! 1. **Security review** — independent audit of the trigger evaluation path,
//!    input validation, and failure handling (fail-closed semantics).
//! 2. **Legal review** — confirmation that parametric triggers and oracle
//!    data feeds comply with applicable regulatory and contractual obligations.
//! 3. **Cryptographic design** — specification and review of oracle
//!    authentication, signed data feeds, replay protection, and key management.
//!
//! Until all three are complete, this module must remain a stub.

/// Error message emitted by every oracle entrypoint in default builds.
pub const ORACLE_TRIGGERS_DISABLED: &str = "ORACLE_TRIGGERS_DISABLED";

/// A parametric trigger definition supplied to the oracle.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Trigger {
    /// Identifier of the trigger.
    pub id: u64,
    /// Opaque payload describing the trigger condition.
    pub condition: Vec<u8>,
}

/// Result of validating a trigger.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TriggerValidation {
    /// Whether the trigger is considered valid.
    pub valid: bool,
}

/// Query the oracle for the current state of a trigger.
///
/// # Panics
///
/// Always panics with [`ORACLE_TRIGGERS_DISABLED`] in default builds.
pub fn query_trigger(_trigger_id: u64) -> Trigger {
    panic!("{}", ORACLE_TRIGGERS_DISABLED);
}

/// Validate a trigger definition against the oracle.
///
/// # Panics
///
/// Always panics with [`ORACLE_TRIGGERS_DISABLED`] in default builds.
pub fn validate_trigger(_trigger: &Trigger) -> TriggerValidation {
    panic!("{}", ORACLE_TRIGGERS_DISABLED);
}

/// Execute a parametric trigger through the oracle.
///
/// # Panics
///
/// Always panics with [`ORACLE_TRIGGERS_DISABLED`] in default builds.
pub fn execute_trigger(_trigger: &Trigger) -> bool {
    panic!("{}", ORACLE_TRIGGERS_DISABLED);
}
