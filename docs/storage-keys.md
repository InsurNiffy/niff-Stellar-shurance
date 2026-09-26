# Contract Storage Key Layout

> **Issue #779** — Exhaustive catalogue of every `DataKey` variant in
> `contracts/niffyinsure/src/storage.rs`.  
> Soroban serialises enum variants to XDR; two variants with the same
> discriminant or identical payload shape would silently collide.  
> See the `storage_key_uniqueness` test for the automated collision gate.

---

## How Soroban derives storage keys

`#[contracttype]` enums are serialised as XDR union types.  Each variant gets a
unique 32-bit integer discriminant assigned in declaration order (0, 1, 2 …).
A parameterised variant like `Policy(Address, u32)` produces a key whose XDR
encoding is `[discriminant_u32][xdr(Address)][xdr(u32)]`.  Two variants
collide only if they share the same discriminant **and** the same runtime
payload — which cannot happen as long as discriminant values are unique.

**The only risk is accidentally reusing a discriminant after refactoring.**
The `storage_key_uniqueness` test in
`contracts/niffyinsure/tests/storage_key_uniqueness.rs` serialises every
unit (non-parameterised) variant and asserts uniqueness in a set.

---

## Tier legend

| Tier | Soroban API | Evicts? |
|---|---|---|
| **Instance** | `env.storage().instance()` | With contract instance |
| **Persistent** | `env.storage().persistent()` | After TTL expires |
| **Temporary** | `env.storage().temporary()` | After TTL expires (short) |

---

## DataKey variant catalogue

### Instance-tier keys (singleton, contract-wide)

| Variant | Type stored | Notes |
|---|---|---|
| `Admin` | `Address` | Current admin; set at `initialize` |
| `PendingAdmin` | `Address` | Two-step rotation proposal |
| `Token` | `Address` | SEP-41 treasury token contract |
| `Treasury` | `Address` | Collected-premium destination |
| `ProtocolFeeBps` | `u32` | Fee in basis points (0–10 000) |
| `FeeRecipient` | `Address` | Receives the protocol fee slice |
| `MinSolvencyRatioBps` | `u32` | Min treasury/obligations ratio |
| `PremiumTable` | `MultiplierTable` | Global premium multiplier table |
| `CalcAddress` | `Address` | Optional external calculator contract |
| `AllowedAsset(Address)` | `bool` | Allowlist flag per asset |
| `Voters` | `Vec<Address>` | DAO voter registry |
| `ClaimCounter` | `u64` | Monotonic claim ID |
| `Paused` | `bool` | Global pause flag |
| `PauseReason` | `String` | Human-readable pause reason |
| `PendingAdminAction` | `PendingAdminAction` | Two-step high-risk action |
| `SweepCap` | `i128` | Per-tx emergency sweep cap |
| `SweepNoticePeriodLedgers` | `u32` | Mandatory delay before sweep execution |
| `AdminActionWindowLedgers` | `u32` | Expiry window for pending actions |
| `ActivePolicyCount(Address)` | `u32` | Active policy count per holder |
| `RollingClaimCap` | `i128` | Max paid claims per rolling window |
| `RollingClaimWindowLedgers` | `u32` | Rolling window length in ledgers |
| `MaxEvidenceCount` | `u32` | Max evidence entries per claim |
| `MinEvidenceCount` | `u32` | Min evidence entries per claim |
| `MaxWeightCap` | `i128` | Max voting weight per voter |
| `LastClaimResolvedLedger(Address, u32)` | `u32` | Cooldown anchor per policy |
| `CooldownLedgers` | `u32` | Cooldown window length |
| `PolicyExpiredEventEndLedger(Address, u32)` | `u32` | Idempotency for expiry events |
| `GatewayAllowlist` | `Vec<String>` | Allowed IPFS gateway prefixes |
| `GovernanceTokenRuntimeEnabled` | `bool` | Runtime toggle for gov token |
| `GovernanceTokenAddress` | `Address` | Future governance token contract |
| `GovernanceTokenConfigVersion` | `u32` | Schema version for gov config |
| `ProposalCounter` | `u64` | Monotonic governance proposal ID |
| `Proposal(u64)` | `GovernanceProposal` | Governance proposal by ID |
| `ProposalVote(u64, Address)` | `i128` | Vote weight per (proposal, voter) |
| `OpenClaim(Address, u32)` | `bool` | Open-claim flag per policy |
| `VoteDurLedgers` | `u32` | Configurable voting window |
| `QuorumBps` | `u32` | Global participation quorum |
| `GracePeriodLedgers` | `u32` | Post-expiry grace period |
| `TtlAlertThreshold` | `u32` | TTL alert threshold |
| `OracleEnabled` | `bool` | Global oracle enable flag |
| `OraclePubKey(Address)` | `BytesN<32>` | Ed25519 key per oracle source |
| `OracleNonce(Address)` | `u64` | Replay-protection nonce per oracle |
| `OracleQuorum(Address)` | `u32` | Required quorum count per oracle |
| `PolicyTypeConfig(PolicyType)` | `PolicyTypeConfig` | Config per policy type |
| `PolicyTypeActive(PolicyType)` | `bool` | Active flag per policy type |
| `PolicyTypeRegistryEnabled` | `bool` | Registry enable flag |
| `AssetPremiumTable(Address)` | `MultiplierTable` | Asset-specific premium table |
| `WhitelistEnabled` | `bool` | KYC whitelist enforcement flag |
| `Whitelisted(Address)` | `bool` | KYC whitelist entry per address |
| `FraudScoreThreshold` | `u32` | Fraud score rejection threshold |
| `ElevatedQuorumBps` | `u32` | Quorum for high-fraud claims |
| `AllowedAssetConfig(Address)` | `AssetConfig` | Per-asset claim amount bounds |
| `Delegation(Address)` | `VoteDelegation` | Delegation record per delegator |
| `DelegationOperatorIndex` | `Vec<Address>` | Index of delegation operators |
| `ReinsuranceContract` | `Address` | Reinsurance fallback address |
| `AuthorizedDepositor(Address)` | `bool` | Treasury depositor allowlist |
| `AllowedPayoutRecipient(Address)` | `bool` | Contract payout allowlist |
| `RegionRegistry` | `Map<String, RegionConfig>` | Region risk multipliers |
| `TreatmentCount(u64)` | `u32` | Treatment count per claim |
| `VetSpecializations(Address)` | `Vec<String>` | Vet specialization registry |
| `SubscriptionCounter` | `u64` | Monotonic subscription ID |
| `Subscription(u64)` | `EventSubscription` | Event subscription by ID |
| `OwnerSubscriptionIds(Address)` | `Vec<u64>` | Subscription IDs per owner |
| `GovernanceCooldownLedgers` | `u32` | Governance param change cooldown |
| `LastParamChangeLedger` | `u32` | Ledger of last param change |
| `MaxSweepPerLedger` | `i128` | Per-ledger sweep withdrawal limit |
| `LastSweepLedger` | `u32` | Ledger of last sweep |
| `CumulativeSweptThisLedger` | `i128` | Running sweep total this ledger |
| `SecsPerLedgerEstimate` | `u32` | Admin-configurable seconds/ledger |
| `PauseAdmin` | `Address` | Role: pause/unpause |
| `TreasuryAdmin` | `Address` | Role: treasury operations |
| `ParamAdmin` | `Address` | Role: governance param changes |

### Persistent-tier keys (per-holder or per-claim)

| Variant | Type stored | Notes |
|---|---|---|
| `Policy(Address, u32)` | `Policy` | Policy record per (holder, policy_id) |
| `PolicyCounter(Address)` | `u32` | Next policy_id per holder |
| `Claim(u64)` | `Claim` | Claim record by claim_id |
| `Vote(u64, Address)` | `VoteOption` | Vote per (claim_id, voter) |
| `VoteDelegations` | `Map<Address, VoteDelegation>` | All active delegations |
| `ClaimVoters(u64)` | `Vec<Address>` | Voter snapshot per claim |
| `LastClaimLedger(Address)` | `u32` | Rate-limit anchor per holder |
| `AppealVote(u64, Address)` | `VoteOption` | Appeal vote per (claim_id, voter) |
| `ClaimQuorumBps(u64)` | `u32` | Quorum snapshot per claim |
| `ClaimRateLimitPrev(u64)` | `u32` | Pre-filing rate-limit value |
| `HolderNonce(Address)` | `u64` | Replay-protection nonce per holder |
| `TriggerCounter` | `u64` | Oracle trigger ID counter |
| `OracleTrigger(u64)` | `OracleTrigger` | Trigger record by ID |
| `TriggerStatus(u64)` | `TriggerStatus` | Trigger status by ID |
| `RollingClaimState(Address, u32)` | `RollingClaimWindowState` | Rolling cap state per policy |
| `CommitRevealPhases(u64)` | `CommitRevealPhases` | Phase boundaries per claim |
| `VoteCommitment(u64, Address)` | `BytesN<32>` | Vote commitment per (claim, voter) |
| `AppealVoters(u64)` | `Vec<Address>` | Appeal voter snapshot per claim |
| `AppealClaimQuorumBps(u64)` | `u32` | Quorum snapshot for appeal round |
| `ClaimFraudScore(u64)` | `u32` | Fraud score per claim |

---

## Collision audit notes

- All unit variants have distinct names; the Rust compiler enforces no two
  variants share the same identifier within an enum.
- Parameterised variants cannot collide with each other or with unit variants
  at the same discriminant because XDR encodes the payload after the discriminant.
- **Discriminant reuse after deletion** is the only real risk. Before removing
  a variant, mark it `// DELETED – discriminant N reserved` and leave a comment
  so future authors do not reuse the number.
- The `storage_key_uniqueness` test asserts uniqueness of serialised unit-variant
  keys and is run on every CI push.

---

## Adding a new DataKey variant

1. Append the variant **at the end** of the enum to avoid renumbering existing
   discriminants.
2. Add a row to the table above.
3. Run `cargo test storage_key_uniqueness` to confirm no collision.
4. Open a PR referencing this document.
