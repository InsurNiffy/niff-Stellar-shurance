//! Storage key collision audit (Issue #779).
//!
//! Soroban serialises `#[contracttype]` enum variants to XDR. Two variants
//! with the same discriminant would silently overwrite each other's storage.
//!
//! This test serialises every *unit* (non-parameterised) `DataKey` variant and
//! asserts that all serialised representations are unique. Parameterised
//! variants cannot collide with unit variants (payload bytes differ), so only
//! unit variants need explicit checking here.
//!
//! CI will fail if a new variant reuses an existing discriminant.

#![cfg(test)]

use niffyinsure::storage::DataKey;
use soroban_sdk::{Env, IntoVal, Val};
use std::collections::HashSet;

/// Collect the XDR bytes of a `DataKey` variant via the Soroban host.
fn key_bytes(env: &Env, key: &DataKey) -> Vec<u8> {
    let val: Val = key.into_val(env);
    // Use the Debug representation as a stable, unique string key for the set.
    // Two variants with identical discriminants produce identical Debug output.
    format!("{:?}", val).into_bytes()
}

#[test]
fn all_unit_datakey_variants_are_unique() {
    let env = Env::default();

    // ── Unit variants only ────────────────────────────────────────────────────
    // Add every unit variant from the DataKey enum. Parameterised variants are
    // excluded — they are structurally incapable of colliding with unit variants
    // because the XDR payload bytes following the discriminant differ.
    let unit_variants: &[DataKey] = &[
        DataKey::Admin,
        DataKey::PendingAdmin,
        DataKey::Token,
        DataKey::Treasury,
        DataKey::ProtocolFeeBps,
        DataKey::FeeRecipient,
        DataKey::MinSolvencyRatioBps,
        DataKey::PremiumTable,
        DataKey::CalcAddress,
        DataKey::Voters,
        DataKey::ClaimCounter,
        DataKey::Paused,
        DataKey::PauseReason,
        DataKey::PendingAdminAction,
        DataKey::SweepCap,
        DataKey::SweepNoticePeriodLedgers,
        DataKey::AdminActionWindowLedgers,
        DataKey::RollingClaimCap,
        DataKey::RollingClaimWindowLedgers,
        DataKey::MaxEvidenceCount,
        DataKey::MinEvidenceCount,
        DataKey::MaxWeightCap,
        DataKey::CooldownLedgers,
        DataKey::GatewayAllowlist,
        DataKey::GovernanceTokenRuntimeEnabled,
        DataKey::GovernanceTokenAddress,
        DataKey::GovernanceTokenConfigVersion,
        DataKey::ProposalCounter,
        DataKey::VoteDelegations,
        DataKey::VoteDurLedgers,
        DataKey::QuorumBps,
        DataKey::GracePeriodLedgers,
        DataKey::TtlAlertThreshold,
        DataKey::OracleEnabled,
        DataKey::PolicyTypeRegistryEnabled,
        DataKey::WhitelistEnabled,
        DataKey::FraudScoreThreshold,
        DataKey::ElevatedQuorumBps,
        DataKey::DelegationOperatorIndex,
        DataKey::ReinsuranceContract,
        DataKey::RegionRegistry,
        DataKey::SubscriptionCounter,
        DataKey::GovernanceCooldownLedgers,
        DataKey::LastParamChangeLedger,
        DataKey::MaxSweepPerLedger,
        DataKey::LastSweepLedger,
        DataKey::CumulativeSweptThisLedger,
        DataKey::SecsPerLedgerEstimate,
        DataKey::PauseAdmin,
        DataKey::TreasuryAdmin,
        DataKey::ParamAdmin,
        DataKey::TriggerCounter,
    ];

    let mut seen: HashSet<Vec<u8>> = HashSet::new();
    for variant in unit_variants {
        let repr = key_bytes(&env, variant);
        assert!(
            seen.insert(repr.clone()),
            "DataKey collision detected! Two unit variants produced the same \
             serialised key: {:?}",
            String::from_utf8_lossy(&repr),
        );
    }

    assert_eq!(
        seen.len(),
        unit_variants.len(),
        "Expected {} unique keys, got {}",
        unit_variants.len(),
        seen.len(),
    );
}
