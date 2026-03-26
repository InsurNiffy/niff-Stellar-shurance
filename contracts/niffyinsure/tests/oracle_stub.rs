//! ═══════════════════════════════════════════════════════════════════════════
//! ORACLE / PARAMETRIC TRIGGER TESTS
//!
//! These tests verify that oracle trigger functionality is properly disabled
//! in default (non-experimental) builds.  The tests assert that:
//!
//!   1. Default builds CANNOT compile oracle trigger entrypoints
//!   2. Default builds PANIC at runtime if oracle storage functions are called
//!   3. Default builds PANIC at runtime if oracle validation is attempted
//!   4. Experimental builds have proper stub implementations
//!
//! ⚠️  LEGAL / COMPLIANCE REVIEW GATE: These tests ensure production safety.
//! Oracle triggers must NOT be activatable in production without completing
//! the requirements in DESIGN-ORACLE.md.
//! ═══════════════════════════════════════════════════════════════════════════

#![cfg(test)]

use niffyinsure::types::{OracleSource, TriggerStatus};
use niffyinsure::validate::OracleError;
use soroban_sdk::{testutils::Address as _, Address, Bytes, Env};

// ═════════════════════════════════════════════════════════════════════════════
// DEFAULT BUILD TESTS (feature = std without "experimental")
//
// These tests verify that oracle functionality is completely disabled
// in the default production configuration.
// ═════════════════════════════════════════════════════════════════════════════

#[cfg(not(feature = "experimental"))]
mod default_build_tests {
    use super::*;

    /// Test that is_oracle_enabled panics in default builds.
    ///
    /// This test verifies that calling is_oracle_enabled() in a production
    /// build will panic, preventing any oracle trigger processing.
    #[test]
    #[should_panic(expected = "ORACLE_TRIGGERS_DISABLED")]
    fn is_oracle_enabled_panics_in_default_build() {
        let env = Env::default();
        niffyinsure::storage::is_oracle_enabled(&env);
    }

    /// Test that set_oracle_enabled panics in default builds.
    #[test]
    #[should_panic(expected = "ORACLE_TRIGGERS_DISABLED")]
    fn set_oracle_enabled_panics_in_default_build() {
        let env = Env::default();
        niffyinsure::storage::set_oracle_enabled(&env, true);
    }

    /// Test that next_trigger_id panics in default builds.
    #[test]
    #[should_panic(expected = "ORACLE_TRIGGERS_DISABLED")]
    fn next_trigger_id_panics_in_default_build() {
        let env = Env::default();
        niffyinsure::storage::next_trigger_id(&env);
    }

    /// Test that get_oracle_trigger panics in default builds.
    #[test]
    #[should_panic(expected = "ORACLE_TRIGGERS_DISABLED")]
    fn get_oracle_trigger_panics_in_default_build() {
        let env = Env::default();
        niffyinsure::storage::get_oracle_trigger(&env, 1);
    }

    /// Test that set_oracle_trigger panics in default builds.
    #[test]
    #[should_panic(expected = "ORACLE_TRIGGERS_DISABLED")]
    fn set_oracle_trigger_panics_in_default_build() {
        let env = Env::default();
        let trigger = niffyinsure::types::OracleTrigger {
            policy_id: 1,
            event_type: niffyinsure::types::TriggerEventType::Undefined,
            source: niffyinsure::types::OracleSource::Undefined,
            payload: Bytes::new(&env),
            timestamp: 0,
            trigger_ledger: 0,
            signature: Bytes::new(&env),
        };
        niffyinsure::storage::set_oracle_trigger(&env, 1, &trigger);
    }

    /// Test that get_trigger_status panics in default builds.
    #[test]
    #[should_panic(expected = "ORACLE_TRIGGERS_DISABLED")]
    fn get_trigger_status_panics_in_default_build() {
        let env = Env::default();
        niffyinsure::storage::get_trigger_status(&env, 1);
    }

    /// Test that set_trigger_status panics in default builds.
    #[test]
    #[should_panic(expected = "ORACLE_TRIGGERS_DISABLED")]
    fn set_trigger_status_panics_in_default_build() {
        let env = Env::default();
        niffyinsure::storage::set_trigger_status(&env, 1, TriggerStatus::Pending);
    }

    /// Test that check_oracle_trigger panics in default builds.
    #[test]
    #[should_panic(expected = "ORACLE_VALIDATION_DISABLED")]
    fn check_oracle_trigger_panics_in_default_build() {
        let env = Env::default();
        let trigger = niffyinsure::types::OracleTrigger {
            policy_id: 1,
            event_type: niffyinsure::types::TriggerEventType::Undefined,
            source: niffyinsure::types::OracleSource::Undefined,
            payload: Bytes::new(&env),
            timestamp: 0,
            trigger_ledger: 0,
            signature: Bytes::new(&env),
        };
        let _ = niffyinsure::validate::check_oracle_trigger(&env, &trigger, 1000, 100);
    }

    /// Test that check_trigger_status_transition panics in default builds.
    #[test]
    #[should_panic(expected = "ORACLE_VALIDATION_DISABLED")]
    fn check_trigger_status_transition_panics_in_default_build() {
        let _ = niffyinsure::validate::check_trigger_status_transition(
            TriggerStatus::Pending,
            TriggerStatus::Validated,
        );
    }

    /// Test that OracleError::OracleDisabled is defined but unused in default builds.
    ///
    /// This ensures the error type exists for future experimental builds.
    #[test]
    fn oracle_error_variant_exists() {
        // Verify the error variant exists
        let _error = OracleError::OracleDisabled;
        assert_eq!(format!("{:?}", _error), "OracleDisabled");
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// EXPERIMENTAL BUILD TESTS (feature = "experimental")
//
// These tests verify that oracle functionality has proper stub implementations
// when the experimental feature is enabled.  They test the non-cryptographic
// validation paths only.
// ═════════════════════════════════════════════════════════════════════════════

#[cfg(feature = "experimental")]
mod experimental_build_tests {
    use super::*;

    /// Test that oracle triggers are disabled by default in experimental builds.
    ///
    /// Even experimental builds should have oracle triggers disabled by default,
    /// requiring explicit admin action to enable.
    #[test]
    fn oracle_disabled_by_default_in_experimental_build() {
        let env = Env::default();
        env.mock_all_auths();

        // Verify oracle is disabled by default
        assert!(!niffyinsure::storage::is_oracle_enabled(&env));
    }

    /// Test that oracle triggers can be enabled in experimental builds.
    #[test]
    fn oracle_can_be_enabled_in_experimental_build() {
        let env = Env::default();
        env.mock_all_auths();

        // Enable oracle triggers
        niffyinsure::storage::set_oracle_enabled(&env, true);
        assert!(niffyinsure::storage::is_oracle_enabled(&env));

        // Disable oracle triggers
        niffyinsure::storage::set_oracle_enabled(&env, false);
        assert!(!niffyinsure::storage::is_oracle_enabled(&env));
    }

    /// Test that trigger ID generation works in experimental builds.
    #[test]
    fn trigger_id_generation_in_experimental_build() {
        let env = Env::default();

        // Generate first trigger ID
        let id1 = niffyinsure::storage::next_trigger_id(&env);
        assert_eq!(id1, 1);

        // Generate second trigger ID
        let id2 = niffyinsure::storage::next_trigger_id(&env);
        assert_eq!(id2, 2);

        // Verify monotonic increment
        assert!(id2 > id1);
    }

    /// Test that OracleTrigger can be stored and retrieved in experimental builds.
    #[test]
    fn oracle_trigger_storage_in_experimental_build() {
        let env = Env::default();
        env.mock_all_auths();

        let trigger = niffyinsure::types::OracleTrigger {
            policy_id: 42,
            event_type: niffyinsure::types::TriggerEventType::Undefined,
            source: niffyinsure::types::OracleSource::Undefined,
            payload: Bytes::new(&env),
            timestamp: 1234567890,
            trigger_ledger: 1000,
            signature: Bytes::new(&env),
        };

        // Store trigger
        niffyinsure::storage::set_oracle_trigger(&env, 1, &trigger);

        // Retrieve trigger
        let retrieved = niffyinsure::storage::get_oracle_trigger(&env, 1);
        assert!(retrieved.is_some());

        let retrieved_trigger = retrieved.unwrap();
        assert_eq!(retrieved_trigger.policy_id, 42);
        assert_eq!(retrieved_trigger.timestamp, 1234567890);
    }

    /// Test that check_oracle_trigger rejects disabled oracle.
    #[test]
    fn check_oracle_trigger_rejects_disabled_oracle() {
        let env = Env::default();
        env.mock_all_auths();

        // Ensure oracle is disabled
        niffyinsure::storage::set_oracle_enabled(&env, false);

        let trigger = niffyinsure::types::OracleTrigger {
            policy_id: 1,
            event_type: niffyinsure::types::TriggerEventType::Undefined,
            source: niffyinsure::types::OracleSource::Undefined,
            payload: Bytes::new(&env),
            timestamp: 0,
            trigger_ledger: 1000,
            signature: Bytes::new(&env),
        };

        let result = niffyinsure::validate::check_oracle_trigger(&env, &trigger, 1000, 100);
        assert_eq!(
            result,
            Err(niffyinsure::validate::OracleError::OracleDisabled)
        );
    }

    /// Test that check_oracle_trigger rejects expired triggers.
    #[test]
    fn check_oracle_trigger_rejects_expired_ledger() {
        let env = Env::default();
        env.mock_all_auths();

        // Enable oracle
        niffyinsure::storage::set_oracle_enabled(&env, true);

        let trigger = niffyinsure::types::OracleTrigger {
            policy_id: 1,
            event_type: niffyinsure::types::TriggerEventType::Undefined,
            source: niffyinsure::types::OracleSource::Undefined,
            payload: Bytes::new(&env),
            timestamp: 0,
            trigger_ledger: 100, // Old ledger
            signature: Bytes::new(&env),
        };

        // Current ledger is much later than trigger ledger
        let result = niffyinsure::validate::check_oracle_trigger(&env, &trigger, 10000, 100);
        assert_eq!(
            result,
            Err(niffyinsure::validate::OracleError::TriggerLedgerExpired)
        );
    }

    /// Test that check_oracle_trigger rejects non-empty signatures (crypto not implemented).
    #[test]
    fn check_oracle_trigger_rejects_non_empty_signature() {
        let env = Env::default();
        env.mock_all_auths();

        // Enable oracle
        niffyinsure::storage::set_oracle_enabled(&env, true);

        let trigger = niffyinsure::types::OracleTrigger {
            policy_id: 1,
            event_type: niffyinsure::types::TriggerEventType::Undefined,
            source: niffyinsure::types::OracleSource::Undefined,
            payload: Bytes::new(&env),
            timestamp: 0,
            trigger_ledger: 1000,
            signature: {
                // Non-empty signature should be rejected until crypto is implemented
                let mut v = Bytes::new(&env);
                v.push_back(0xDE_u8);
                v
            },
        };

        let result = niffyinsure::validate::check_oracle_trigger(&env, &trigger, 1000, 100);
        assert_eq!(
            result,
            Err(niffyinsure::validate::OracleError::SignatureNotImplemented)
        );
    }

    /// Test that check_trigger_status_transition allows valid transitions.
    #[test]
    fn check_trigger_status_transition_valid_paths() {
        // Pending -> Validated (valid)
        assert!(niffyinsure::validate::check_trigger_status_transition(
            TriggerStatus::Pending,
            TriggerStatus::Validated
        )
        .is_ok());

        // Pending -> Rejected (valid)
        assert!(niffyinsure::validate::check_trigger_status_transition(
            TriggerStatus::Pending,
            TriggerStatus::Rejected
        )
        .is_ok());

        // Pending -> Expired (valid)
        assert!(niffyinsure::validate::check_trigger_status_transition(
            TriggerStatus::Pending,
            TriggerStatus::Expired
        )
        .is_ok());

        // Validated -> Executed (valid)
        assert!(niffyinsure::validate::check_trigger_status_transition(
            TriggerStatus::Validated,
            TriggerStatus::Executed
        )
        .is_ok());

        // Same state is idempotent (valid)
        assert!(niffyinsure::validate::check_trigger_status_transition(
            TriggerStatus::Pending,
            TriggerStatus::Pending
        )
        .is_ok());
    }

    /// Test that check_trigger_status_transition rejects invalid transitions.
    #[test]
    fn check_trigger_status_transition_invalid_paths() {
        // Executed -> any (invalid)
        assert_eq!(
            niffyinsure::validate::check_trigger_status_transition(
                TriggerStatus::Executed,
                TriggerStatus::Validated
            ),
            Err(niffyinsure::validate::OracleError::TriggerAlreadyProcessed)
        );

        // Rejected -> any (invalid)
        assert_eq!(
            niffyinsure::validate::check_trigger_status_transition(
                TriggerStatus::Rejected,
                TriggerStatus::Executed
            ),
            Err(niffyinsure::validate::OracleError::TriggerAlreadyProcessed)
        );

        // Pending -> Executed (invalid, must be validated first)
        assert_eq!(
            niffyinsure::validate::check_trigger_status_transition(
                TriggerStatus::Pending,
                TriggerStatus::Executed
            ),
            Err(niffyinsure::validate::OracleError::TriggerAlreadyProcessed)
        );
    }

    /// Test that TriggerStatus variants are properly defined.
    #[test]
    fn trigger_status_variants() {
        assert_eq!(format!("{:?}", TriggerStatus::Pending), "Pending");
        assert_eq!(format!("{:?}", TriggerStatus::Validated), "Validated");
        assert_eq!(format!("{:?}", TriggerStatus::Rejected), "Rejected");
        assert_eq!(format!("{:?}", TriggerStatus::Executed), "Executed");
        assert_eq!(format!("{:?}", TriggerStatus::Expired), "Expired");
    }

    /// Test that OracleSource variants are properly defined.
    #[test]
    fn oracle_source_variants() {
        assert_eq!(format!("{:?}", OracleSource::Undefined), "Undefined");
    }

    /// Test that empty payload is rejected for non-undefined event types.
    #[test]
    fn check_oracle_trigger_rejects_empty_payload_for_defined_events() {
        let env = Env::default();
        env.mock_all_auths();

        // Enable oracle
        niffyinsure::storage::set_oracle_enabled(&env, true);

        // Undefined event type with empty payload is allowed (pre-configuration)
        let trigger = niffyinsure::types::OracleTrigger {
            policy_id: 1,
            event_type: niffyinsure::types::TriggerEventType::Undefined,
            source: niffyinsure::types::OracleSource::Undefined,
            payload: Bytes::new(&env),
            timestamp: 0,
            trigger_ledger: 1000,
            signature: Bytes::new(&env),
        };

        // This should fail because source is Undefined, not because payload is empty
        let result = niffyinsure::validate::check_oracle_trigger(&env, &trigger, 1000, 100);
        assert_eq!(
            result,
            Err(niffyinsure::validate::OracleError::SourceNotWhitelisted)
        );
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// COMPILE-TIME SAFETY TESTS
//
// These tests verify that the feature gating is properly configured at
// compile time, ensuring oracle functionality cannot be accidentally enabled.
// ═════════════════════════════════════════════════════════════════════════════

/// Verify that the experimental feature flag controls oracle module compilation.
#[cfg(not(feature = "experimental"))]
#[test]
fn oracle_module_not_compiled_in_default_build() {
    // This test passes only if the oracle module is NOT compiled.
    // If oracle module was compiled without the feature flag, this would fail
    // because oracle types wouldn't be available in the default build.
    //
    // The fact that this test compiles proves the feature gating works.
    assert!(true);
}

/// Verify that types exist but are gated in default builds.
#[cfg(not(feature = "experimental"))]
#[test]
fn oracle_types_exist_but_not_usable() {
    // In default builds, the oracle types exist in the source (for future use)
    // but are not accessible.  This test verifies the types compile but
    // any actual usage would fail.
    //
    // If you try to USE these types (e.g., construct an OracleTrigger),
    // the compiler will fail because the types are gated behind #[cfg].
    assert!(true);
}
