//! Storage key collision audit (Issue #817).
//!
//! Soroban serialises `#[contracttype]` enum variants to XDR for use as
//! persistent storage keys. Two variants with the same discriminant would
//! silently overwrite each other's storage, causing data corruption.
//!
//! This test serialises every `DataKey` variant (both unit and parameterised)
//! and asserts that all serialised representations are distinct.
//!
//! CI will fail if a new variant reuses an existing discriminant.

#![cfg(test)]

use niffyinsure::storage::DataKey;
use niffyinsure::types::PolicyType;
use soroban_sdk::{Address, Env, IntoVal, String, Val};
use std::collections::HashSet;

/// The canonical zero-address used as a placeholder parameter value.
const ZERO_STRKEY: &str = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/// Construct the zero address for use as a placeholder parameter.
fn zero_address(env: &Env) -> Address {
    Address::from_string(&String::from_str(env, ZERO_STRKEY))
}

/// Collect the XDR bytes of a `DataKey` variant via the Soroban host.
fn key_val(env: &Env, key: &DataKey) -> Val {
    key.into_val(env)
}

/// All unit (parameter-free) `DataKey` variants.
fn all_unit_variants(env: &Env) -> Vec<DataKey> {
    vec![
        DataKey::Admin,
        DataKey::PendingAdmin,
        DataKey::PendingAdminExpiry,
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
        DataKey::TriggerCounter,
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
        DataKey::MinCoverageAmount,
        DataKey::MaxVotersPerClaim,
        DataKey::ClaimFilingFee,
    ]
}

/// All parameterised `DataKey` variants with representative (zero/minimum)
/// parameter values.  Each variant is paired with a concrete instantiation
/// so that its XDR serialisation can be checked for collisions.
fn all_parameterised_variants(env: &Env) -> Vec<DataKey> {
    let za = zero_address(env);
    vec![
        DataKey::AllowedAsset(za.clone()),
        DataKey::ActivePolicyCount(za.clone()),
        DataKey::LastClaimResolvedLedger(za.clone(), 0),
        DataKey::PolicyExpiredEventEndLedger(za.clone(), 0),
        DataKey::Policy(za.clone(), 0),
        DataKey::PolicyCounter(za.clone()),
        DataKey::Proposal(0),
        DataKey::ProposalVote(0, za.clone()),
        DataKey::Claim(0),
        DataKey::OpenClaim(za.clone(), 0),
        DataKey::Vote(0, za.clone()),
        DataKey::AppealVote(0, za.clone()),
        DataKey::ClaimVoters(0),
        DataKey::LastClaimLedger(za.clone()),
        DataKey::AppealVoters(0),
        DataKey::AppealClaimQuorumBps(0),
        DataKey::ClaimQuorumBps(0),
        DataKey::ClaimRateLimitPrev(0),
        DataKey::ClaimFilingFeePaid(0),
        DataKey::ClaimVoterPowerOverride(0, za.clone()),
        DataKey::HolderNonce(za.clone()),
        DataKey::OracleTrigger(0),
        DataKey::TriggerStatus(0),
        DataKey::OraclePubKey(za.clone()),
        DataKey::OracleNonce(za.clone()),
        DataKey::OracleQuorum(za.clone()),
        DataKey::RollingClaimState(za.clone(), 0),
        DataKey::CommitRevealPhases(0),
        DataKey::VoteCommitment(0, za.clone()),
        DataKey::PolicyTypeConfig(PolicyType::Auto),
        DataKey::PolicyTypeActive(PolicyType::Auto),
        DataKey::AssetPremiumTable(za.clone()),
        DataKey::Whitelisted(za.clone()),
        DataKey::ClaimFraudScore(0),
        DataKey::AllowedAssetConfig(za.clone()),
        DataKey::Delegation(za.clone()),
        DataKey::AuthorizedDepositor(za.clone()),
        DataKey::AllowedPayoutRecipient(za.clone()),
        DataKey::TreatmentCount(0),
        DataKey::VetSpecializations(za.clone()),
        DataKey::Subscription(0),
        DataKey::OwnerSubscriptionIds(za.clone()),
        DataKey::AssetDecimals(za.clone()),
    ]
}

/// Every DataKey variant (unit + parameterised) must serialise to a unique
/// Val.  A collision means two distinct keys would map to the same Soroban
/// storage slot and silently corrupt each other's data.
#[test]
fn all_datakey_variants_are_unique() {
    let env = Env::default();

    let mut seen: HashSet<Val> = HashSet::new();

    for key in all_unit_variants(&env).into_iter().chain(all_parameterised_variants(&env)) {
        let val = key_val(&env, &key);
        assert!(
            seen.insert(val),
            "DataKey collision detected: {:?} shares a storage slot with another variant",
            key,
        );
    }
}
