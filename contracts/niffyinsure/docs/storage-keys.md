# Storage Key Layout

This document describes the complete `DataKey` enum used by the `niffyinsure`
contract for Soroban persistent storage. Every variant maps to a distinct
storage slot via XDR serialisation.

## Key Schema

The contract uses a single `#[contracttype]` enum, `DataKey`, whose variants
serve as keys for Soroban instance storage. Soroban serialises enum variants
to XDR (External Data Representation) before using the bytes as the storage
slot address. Two variants that share a discriminant would map to the same
slot and silently corrupt each other's data.

### Serialisation Rules

| Variant shape | XDR encoding |
|---|---|
| Unit variant (no fields) | Discriminant only (u32) |
| Parameterised variant | Discriminant (u32) + payload bytes |

The discriminant is the variant's position in the enum declaration (starting
from 0). Soroban's `#[contracttype]` derive encodes this as a variable-length
unsigned integer followed by the field values.

## Naming Conventions

- **PascalCase** for all variant names.
- **Unit variants** represent scalar flags, counters, or single-value
  settings (e.g., `Admin`, `Paused`, `ClaimCounter`).
- **Parameterised variants** carry one or more fields that further scope the
  key:
  - `(Address)` — per-account key (e.g., `AllowedAsset`, `PolicyCounter`).
  - `(u64)` — per-claim or per-proposal key (e.g., `Claim`, `Proposal`).
  - `(Address, u32)` — per-account, per-policy key (e.g., `Policy`, `OpenClaim`).
  - `(u64, Address)` — per-claim, per-voter key (e.g., `Vote`, `AppealVote`).
  - `(PolicyType)` — per-policy-type key (e.g., `PolicyTypeConfig`).

## Variant Inventory

### Instance Tier (no address scoping)

| Variant | Shape | Purpose |
|---|---|---|
| `Admin` | unit | Contract admin address |
| `PendingAdmin` | unit | Pending admin (time-locked transition) |
| `PendingAdminExpiry` | unit | Ledger expiry for pending admin proposal |
| `PendingAdminAction` | unit | Pending high-risk admin action payload |
| `Token` | unit | Premium token contract address |
| `Treasury` | unit | Treasury (premium collection) address |
| `ProtocolFeeBps` | unit | Basis-point protocol fee |
| `FeeRecipient` | unit | Address receiving protocol fees |
| `MinSolvencyRatioBps` | unit | Minimum treasury solvency ratio |
| `PremiumTable` | unit | Global premium multiplier table |
| `CalcAddress` | unit | Premium calculator contract address |
| `Voters` | unit | Voter registry map |
| `ClaimCounter` | unit | Monotonic claim ID counter |
| `Paused` | unit | Pause flag |
| `PauseReason` | unit | Active pause reason string |
| `SweepCap` | unit | Per-transaction sweep cap |
| `SweepNoticePeriodLedgers` | unit | Min ledgers between sweep proposal and execution |
| `AdminActionWindowLedgers` | unit | Ledger window for pending admin actions |
| `RollingClaimCap` | unit | Max paid claim amount per rolling window |
| `RollingClaimWindowLedgers` | unit | Length of each rolling window |
| `MaxEvidenceCount` | unit | Admin-configured max evidence entries per claim |
| `MinEvidenceCount` | unit | Admin-configured min evidence entries per claim |
| `MaxWeightCap` | unit | Max vote weight per voter (governance token) |
| `GatewayAllowlist` | unit | Allowlisted IPFS gateway prefixes |
| `GovernanceTokenRuntimeEnabled` | unit | Runtime toggle for governance token logic |
| `GovernanceTokenAddress` | unit | Future token contract address (stub) |
| `GovernanceTokenConfigVersion` | unit | Schema/migration version for governance config |
| `ProposalCounter` | unit | Monotonic governance proposal ID counter |
| `VoteDelegations` | unit | Delegator → delegate mapping |
| `VoteDurLedgers` | unit | Configurable voting window in ledgers |
| `QuorumBps` | unit | Participation quorum in basis points |
| `GracePeriodLedgers` | unit | Grace period for late renewals |
| `TtlAlertThreshold` | unit | TTL expiry alert threshold |
| `TriggerCounter` | unit | Monotonic oracle trigger ID counter |
| `OracleEnabled` | unit | Oracle triggers global toggle |
| `PolicyTypeRegistryEnabled` | unit | Policy type registry toggle |
| `WhitelistEnabled` | unit | KYC whitelist enforcement toggle |
| `FraudScoreThreshold` | unit | Threshold for elevated quorum triggers |
| `ElevatedQuorumBps` | unit | Elevated quorum for high-fraud claims |
| `DelegationOperatorIndex` | unit | Ordered index of delegation operators |
| `ReinsuranceContract` | unit | Reinsurance pool contract address |
| `RegionRegistry` | unit | Region tier registry |
| `SubscriptionCounter` | unit | Monotonic subscription ID counter |
| `GovernanceCooldownLedgers` | unit | Governance action cooldown window |
| `LastParamChangeLedger` | unit | Ledger of last governance parameter change |
| `MaxSweepPerLedger` | unit | Max treasury sweeps per ledger |
| `LastSweepLedger` | unit | Ledger of last sweep execution |
| `CumulativeSweptThisLedger` | unit | Running total swept in current ledger |
| `SecsPerLedgerEstimate` | unit | Admin-configured seconds-per-ledger estimate |
| `PauseAdmin` | unit | Address authorised to pause/unpause |
| `TreasuryAdmin` | unit | Address authorised for treasury operations |
| `ParamAdmin` | unit | Address authorised for governance parameter changes |
| `MinCoverageAmount` | unit | Minimum coverage amount floor |
| `MaxVotersPerClaim` | unit | Hard cap on eligible voters per claim |
| `ClaimFilingFee` | unit | Optional flat fee (stroops) charged at file_claim |

### Per-Asset Keys

| Variant | Shape | Purpose |
|---|---|---|
| `AllowedAsset` | `(Address)` | Allowlist flag per asset contract |
| `AssetPremiumTable` | `(Address)` | Asset-specific multiplier table |
| `AssetDecimals` | `(Address)` | Stored decimals for an allowlisted asset |
| `AllowedAssetConfig` | `(Address)` | Per-asset claim amount bounds config |

### Per-Policy Keys

| Variant | Shape | Purpose |
|---|---|---|
| `Policy` | `(Address, u32)` | Policy record (holder, policy_id) |
| `PolicyCounter` | `(Address)` | Monotonic policy ID counter per holder |
| `ActivePolicyCount` | `(Address)` | Count of active policies per holder |
| `LastClaimResolvedLedger` | `(Address, u32)` | Last resolved claim ledger per policy |
| `PolicyExpiredEventEndLedger` | `(Address, u32)` | Last end_ledger for PolicyExpired event |
| `OpenClaim` | `(Address, u32)` | Temp open-claim check flag |
| `RollingClaimState` | `(Address, u32)` | Rolling window accumulator per policy |
| `LastClaimLedger` | `(Address)` | Last claim filing ledger per holder |
| `LastClaimResolvedLedger` | `(Address, u32)` | Per-policy last resolved claim ledger |

### Per-Claim Keys

| Variant | Shape | Purpose |
|---|---|---|
| `Claim` | `(u64)` | Claim record by claim ID |
| `ClaimVoters` | `(u64)` | Snapshot of eligible voters for a claim |
| `ClaimQuorumBps` | `(u64)` | Quorum bps snapshot at claim filing |
| `ClaimRateLimitPrev` | `(u64)` | Previous LastClaimLedger value before this claim |
| `ClaimFilingFeePaid` | `(u64)` | Filing fee actually collected for a claim |
| `ClaimVoterPowerOverride` | `(u64, Address)` | Test/ops-only voter power override |
| `ClaimFraudScore` | `(u64)` | Fraud score for a claim |
| `AppealVoters` | `(u64)` | Voter snapshot for an appeal round |
| `AppealClaimQuorumBps` | `(u64)` | Quorum bps snapshot at appeal open |
| `AppealVote` | `(u64, Address)` | Appeal round vote (claim_id, voter) |

### Per-Vote Keys

| Variant | Shape | Purpose |
|---|---|---|
| `Vote` | `(u64, Address)` | Governance vote (proposal_id, voter) |
| `VoteCommitment` | `(u64, Address)` | Commit-reveal commitment hash |

### Governance Keys

| Variant | Shape | Purpose |
|---|---|---|
| `Proposal` | `(u64)` | Governance proposal record |
| `ProposalVote` | `(u64, Address)` | Proposal vote weight (proposal_id, voter) |

### Oracle / Trigger Keys

| Variant | Shape | Purpose |
|---|---|---|
| `OracleTrigger` | `(u64)` | Full trigger record by trigger ID |
| `TriggerStatus` | `(u64)` | Current status of a trigger |
| `OraclePubKey` | `(Address)` | Registered Ed25519 public key per oracle |
| `OracleNonce` | `(Address)` | Replay-protection nonce per oracle source |
| `OracleQuorum` | `(Address)` | Required quorum count per oracle source |

### KYC Whitelist Keys

| Variant | Shape | Purpose |
|---|---|---|
| `Whitelisted` | `(Address)` | Per-address KYC whitelist entry |

### Appeal Mechanism Keys

(Keys under the appeal mechanism are covered in the per-claim table above
(`AppealVoters`, `AppealClaimQuorumBps`, `AppealVote`).)

### Appeal / Dispute Keys

(No additional storage keys are allocated for the appeal/dispute mechanism
beyond those listed in the per-claim table.)

### Treatment & Vet Keys

| Variant | Shape | Purpose |
|---|---|---|
| `TreatmentCount` | `(u64)` | Treatment tracking counter |
| `VetSpecializations` | `(Address)` | Vet specialization registry per address |

### Subscription Keys

| Variant | Shape | Purpose |
|---|---|---|
| `Subscription` | `(u64)` | Subscription record by subscription ID |
| `OwnerSubscriptionIds` | `(Address)` | Per-owner list of subscription IDs |

### Delegation & Authorization Keys

| Variant | Shape | Purpose |
|---|---|---|
| `Delegation` | `(Address)` | Delegation record per address |
| `AuthorizedDepositor` | `(Address)` | Treasury depositor allowlist entry |
| `AllowedPayoutRecipient` | `(Address)` | Contract payout recipient allowlist entry |

### Policy Type Registry Keys

| Variant | Shape | Purpose |
|---|---|---|
| `PolicyTypeConfig` | `(PolicyType)` | Per-policy-type admin configuration |
| `PolicyTypeActive` | `(PolicyType)` | Whether a policy type is registered |

### Commit-Reveal Keys

| Variant | Shape | Purpose |
|---|---|---|
| `CommitRevealPhases` | `(u64)` | Commit and reveal phase ledger boundaries |

### Holder Nonce

| Variant | Shape | Purpose |
|---|---|---|
| `HolderNonce` | `(Address)` | Per-holder replay-protection nonce |
