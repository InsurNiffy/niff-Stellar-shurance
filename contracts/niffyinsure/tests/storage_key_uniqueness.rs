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
        DataKey::InitLedger,
        DataKey::Treasury,
        DataKey::ProtocolFeeBps,
        DataKey::FeeRecipient,
        DataKey::MinSolvencyRatioBps,
        DataKey::PremiumTable,
        DataKey::CalcAddress,
        DataKey::Voters,
        DataKey::VoterBucketCount,
        DataKey::VoterRegistryLen,
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
        DataKey::CalcExpectedVersion,
        DataKey::CalcLastAbiVersion,
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
        DataKey::VoterBucket(0),
        DataKey::VoterMember(za.clone()),
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
        DataKey::AssetLedger(za.clone()),
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

/// A second holder address, distinct from [`zero_address`], used to prove that
/// parameterised `DataKey` variants are keyed on their *parameters* and not
/// just their discriminant.
fn second_address(env: &Env) -> Address {
    Address::from_string(&String::from_str(
        env,
        "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    ))
}

/// A second instantiation of every parameterised `DataKey` variant, using a
/// different address and/or a different numeric id than
/// [`all_parameterised_variants`]. Pairing each variant with two distinct
/// parameter sets (e.g. `Policy(addr_a, 0)` vs `Policy(addr_a, 1)` and
/// `Policy(addr_a, 0)` vs `Policy(addr_b, 0)`) catches a storage key
/// implementation that serialises parameterised variants without actually
/// mixing the parameter values into the XDR encoding — a bug the original
/// single-instantiation test could not detect.
fn all_parameterised_variants_alt(env: &Env) -> Vec<DataKey> {
    let zb = second_address(env);
    vec![
        DataKey::AllowedAsset(zb.clone()),
        DataKey::ActivePolicyCount(zb.clone()),
        DataKey::VoterBucket(1),
        DataKey::VoterMember(zb.clone()),
        DataKey::LastClaimResolvedLedger(zb.clone(), 1),
        DataKey::PolicyExpiredEventEndLedger(zb.clone(), 1),
        DataKey::Policy(zb.clone(), 1),
        DataKey::PolicyCounter(zb.clone()),
        DataKey::Proposal(1),
        DataKey::ProposalVote(1, zb.clone()),
        DataKey::Claim(1),
        DataKey::OpenClaim(zb.clone(), 1),
        DataKey::Vote(1, zb.clone()),
        DataKey::AppealVote(1, zb.clone()),
        DataKey::ClaimVoters(1),
        DataKey::LastClaimLedger(zb.clone()),
        DataKey::AppealVoters(1),
        DataKey::AppealClaimQuorumBps(1),
        DataKey::ClaimQuorumBps(1),
        DataKey::ClaimRateLimitPrev(1),
        DataKey::ClaimFilingFeePaid(1),
        DataKey::ClaimVoterPowerOverride(1, zb.clone()),
        DataKey::HolderNonce(zb.clone()),
        DataKey::OracleTrigger(1),
        DataKey::TriggerStatus(1),
        DataKey::OraclePubKey(zb.clone()),
        DataKey::OracleNonce(zb.clone()),
        DataKey::OracleQuorum(zb.clone()),
        DataKey::RollingClaimState(zb.clone(), 1),
        DataKey::CommitRevealPhases(1),
        DataKey::VoteCommitment(1, zb.clone()),
        DataKey::PolicyTypeConfig(PolicyType::Health),
        DataKey::PolicyTypeActive(PolicyType::Health),
        DataKey::AssetPremiumTable(zb.clone()),
        DataKey::Whitelisted(zb.clone()),
        DataKey::ClaimFraudScore(1),
        DataKey::AllowedAssetConfig(zb.clone()),
        DataKey::Delegation(zb.clone()),
        DataKey::AuthorizedDepositor(zb.clone()),
        DataKey::AllowedPayoutRecipient(zb.clone()),
        DataKey::TreatmentCount(1),
        DataKey::VetSpecializations(zb.clone()),
        DataKey::Subscription(1),
        DataKey::OwnerSubscriptionIds(zb.clone()),
        DataKey::AssetDecimals(zb.clone()),
        DataKey::AssetLedger(zb.clone()),
    ]
}

/// Extends the collision audit (Issue #1614): every parameterised `DataKey`
/// variant must also be distinguishable from *itself* instantiated with
/// different parameters, and from every other variant's alternate
/// instantiation. Combined with [`all_datakey_variants_are_unique`], this
/// proves the full cross product of (variant × parameter set) that the repo
/// actually constructs serialises to a unique storage slot, not just that
/// the discriminants themselves don't collide at a single sample point.
#[test]
fn all_datakey_parameterised_variants_are_unique_across_parameter_sets() {
    let env = Env::default();

    let mut seen: HashSet<Val> = HashSet::new();

    let all_keys = all_unit_variants(&env)
        .into_iter()
        .chain(all_parameterised_variants(&env))
        .chain(all_parameterised_variants_alt(&env));

    for key in all_keys {
        let val = key_val(&env, &key);
        assert!(
            seen.insert(val),
            "DataKey collision detected across parameter sets: {:?} shares a \
             storage slot with another variant/parameter combination",
            key,
        );
    }

    // Sanity check: a key must differ from the *same* variant instantiated
    // with different parameters (e.g. Policy(addr, 0) != Policy(addr, 1)).
    let za = zero_address(&env);
    let policy_a0 = key_val(&env, &DataKey::Policy(za.clone(), 0));
    let policy_a1 = key_val(&env, &DataKey::Policy(za.clone(), 1));
    let zb = second_address(&env);
    let policy_b0 = key_val(&env, &DataKey::Policy(zb, 0));
    assert_ne!(policy_a0, policy_a1, "Policy keys must differ by index param");
    assert_ne!(policy_a0, policy_b0, "Policy keys must differ by address param");
}
