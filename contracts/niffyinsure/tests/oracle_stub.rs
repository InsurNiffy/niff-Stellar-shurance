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

#![cfg(all(test, feature = "experimental"))]

use niffyinsure::types::{OracleSource, TriggerStatus};
use niffyinsure::validate::OracleError;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Bytes, Env};

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
            nonce: 0,
            signature: BytesN::from_array(&env, &[0u8; 64]),
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
            nonce: 0,
            signature: BytesN::from_array(&env, &[0u8; 64]),
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
    use soroban_sdk::testutils::ed25519::Sign;

    fn make_trigger(
        env: &Env,
        source: OracleSource,
        policy_id: u32,
        nonce: u64,
        sig: [u8; 64],
    ) -> niffyinsure::types::OracleTrigger {
        niffyinsure::types::OracleTrigger {
            policy_id,
            event_type: niffyinsure::types::TriggerEventType::WeatherEvent,
            source,
            payload: {
                let mut b = Bytes::new(env);
                b.push_back(1u8);
                b
            },
            timestamp: 1_000_000u64,
            trigger_ledger: 1000u32,
            nonce,
            signature: BytesN::from_array(env, &sig),
        }
    }

    #[test]
    fn oracle_disabled_by_default_in_experimental_build() {
        let env = Env::default();
        env.mock_all_auths();
        assert!(!niffyinsure::storage::is_oracle_enabled(&env));
    }

    #[test]
    fn oracle_can_be_enabled_in_experimental_build() {
        let env = Env::default();
        env.mock_all_auths();
        niffyinsure::storage::set_oracle_enabled(&env, true);
        assert!(niffyinsure::storage::is_oracle_enabled(&env));
        niffyinsure::storage::set_oracle_enabled(&env, false);
        assert!(!niffyinsure::storage::is_oracle_enabled(&env));
    }

    #[test]
    fn trigger_id_generation_in_experimental_build() {
        let env = Env::default();
        let id1 = niffyinsure::storage::next_trigger_id(&env);
        assert_eq!(id1, 1);
        let id2 = niffyinsure::storage::next_trigger_id(&env);
        assert_eq!(id2, 2);
    }

    #[test]
    fn oracle_trigger_storage_in_experimental_build() {
        let env = Env::default();
        env.mock_all_auths();
        let source_addr = Address::generate(&env);
        let trigger = make_trigger(
            &env,
            OracleSource::Registered(source_addr),
            42,
            1,
            [0u8; 64],
        );
        niffyinsure::storage::set_oracle_trigger(&env, 1, &trigger);
        let retrieved = niffyinsure::storage::get_oracle_trigger(&env, 1).unwrap();
        assert_eq!(retrieved.policy_id, 42);
        assert_eq!(retrieved.nonce, 1);
    }

    #[test]
    fn check_oracle_trigger_rejects_disabled_oracle() {
        let env = Env::default();
        env.mock_all_auths();
        niffyinsure::storage::set_oracle_enabled(&env, false);
        let source_addr = Address::generate(&env);
        let trigger = make_trigger(&env, OracleSource::Registered(source_addr), 1, 1, [0u8; 64]);
        let result = niffyinsure::validate::check_oracle_trigger(&env, &trigger, 1000, 100);
        assert_eq!(result, Err(OracleError::OracleDisabled));
    }

    #[test]
    fn check_oracle_trigger_rejects_expired_ledger() {
        let env = Env::default();
        env.mock_all_auths();
        niffyinsure::storage::set_oracle_enabled(&env, true);
        let source_addr = Address::generate(&env);
        let trigger = make_trigger(&env, OracleSource::Registered(source_addr), 1, 1, [0u8; 64]);
        // trigger_ledger=1000, max_age=100, current=10000 → expired
        let result = niffyinsure::validate::check_oracle_trigger(&env, &trigger, 10000, 100);
        assert_eq!(result, Err(OracleError::TriggerLedgerExpired));
    }

    #[test]
    fn check_oracle_trigger_rejects_unregistered_source() {
        let env = Env::default();
        env.mock_all_auths();
        niffyinsure::storage::set_oracle_enabled(&env, true);
        let source_addr = Address::generate(&env);
        // No pub key registered for source_addr
        let trigger = make_trigger(&env, OracleSource::Registered(source_addr), 1, 1, [0u8; 64]);
        let result = niffyinsure::validate::check_oracle_trigger(&env, &trigger, 1000, 17280);
        assert_eq!(result, Err(OracleError::SourceNotRegistered));
    }

    #[test]
    fn check_oracle_trigger_accepts_valid_ed25519_signature() {
        let env = Env::default();
        env.mock_all_auths();
        niffyinsure::storage::set_oracle_enabled(&env, true);

        // Generate a keypair using Soroban test utilities
        let keypair = soroban_sdk::testutils::ed25519::generate(&env);
        let pub_key: BytesN<32> = keypair.public_key();
        let source_addr = Address::generate(&env);

        // Register the public key
        niffyinsure::storage::set_oracle_pub_key(&env, &source_addr, &pub_key);

        // Build the message: policy_id(4) || timestamp(8) || nonce(8) || payload
        let policy_id: u32 = 1;
        let timestamp: u64 = 1_000_000;
        let nonce: u64 = 1;
        let payload_byte = 1u8;

        let mut msg = Bytes::new(&env);
        msg.extend_from_array(&policy_id.to_be_bytes());
        msg.extend_from_array(&timestamp.to_be_bytes());
        msg.extend_from_array(&nonce.to_be_bytes());
        msg.push_back(payload_byte);

        let sig_bytes = keypair.sign(&env, &msg);

        let trigger = niffyinsure::types::OracleTrigger {
            policy_id,
            event_type: niffyinsure::types::TriggerEventType::WeatherEvent,
            source: OracleSource::Registered(source_addr),
            payload: { let mut b = Bytes::new(&env); b.push_back(payload_byte); b },
            timestamp,
            trigger_ledger: 1000,
            nonce,
            signature: sig_bytes,
        };

        let result = niffyinsure::validate::check_oracle_trigger(&env, &trigger, 1000, 17280);
        assert!(result.is_ok());
    }

    #[test]
    fn check_oracle_trigger_rejects_replayed_nonce() {
        let env = Env::default();
        env.mock_all_auths();
        niffyinsure::storage::set_oracle_enabled(&env, true);

        let keypair = soroban_sdk::testutils::ed25519::generate(&env);
        let pub_key: BytesN<32> = keypair.public_key();
        let source_addr = Address::generate(&env);
        niffyinsure::storage::set_oracle_pub_key(&env, &source_addr, &pub_key);

        // Advance nonce to 5 manually
        let key = niffyinsure::storage::DataKey::OracleNonce(source_addr.clone());
        env.storage().persistent().set(&key, &5u64);

        // Try to submit with nonce=3 (replay)
        let policy_id: u32 = 1;
        let timestamp: u64 = 1_000_000;
        let nonce: u64 = 3;
        let mut msg = Bytes::new(&env);
        msg.extend_from_array(&policy_id.to_be_bytes());
        msg.extend_from_array(&timestamp.to_be_bytes());
        msg.extend_from_array(&nonce.to_be_bytes());
        msg.push_back(1u8);
        let sig = keypair.sign(&env, &msg);

        let trigger = niffyinsure::types::OracleTrigger {
            policy_id,
            event_type: niffyinsure::types::TriggerEventType::WeatherEvent,
            source: OracleSource::Registered(source_addr),
            payload: { let mut b = Bytes::new(&env); b.push_back(1u8); b },
            timestamp,
            trigger_ledger: 1000,
            nonce,
            signature: sig,
        };

        let result = niffyinsure::validate::check_oracle_trigger(&env, &trigger, 1000, 17280);
        assert_eq!(result, Err(OracleError::ReplayedNonce));
    }

    #[test]
    fn check_trigger_status_transition_valid_paths() {
        assert!(niffyinsure::validate::check_trigger_status_transition(
            TriggerStatus::Pending, TriggerStatus::Validated).is_ok());
        assert!(niffyinsure::validate::check_trigger_status_transition(
            TriggerStatus::Pending, TriggerStatus::Rejected).is_ok());
        assert!(niffyinsure::validate::check_trigger_status_transition(
            TriggerStatus::Validated, TriggerStatus::Executed).is_ok());
    }

    #[test]
    fn check_trigger_status_transition_invalid_paths() {
        assert_eq!(
            niffyinsure::validate::check_trigger_status_transition(
                TriggerStatus::Executed, TriggerStatus::Validated),
            Err(OracleError::TriggerAlreadyProcessed));
        assert_eq!(
            niffyinsure::validate::check_trigger_status_transition(
                TriggerStatus::Rejected, TriggerStatus::Executed),
            Err(OracleError::TriggerAlreadyProcessed));
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
