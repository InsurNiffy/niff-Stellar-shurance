# Oracle / Parametric Trigger Design Document

**Status:** STUB / PRE-REVIEW  
**Feature Flag:** `experimental`  
**Default Build:** INERT (oracle triggers cannot be processed)

---

## Overview

This document outlines the design for enabling oracle-triggered parametric insurance within the NiffyInsure smart contract. Parametric insurance differs from traditional indemnity insurance in that payouts are triggered automatically by objective events (e.g., weather data, flight cancellations) rather than subjective loss assessments.

**Current Status:** This is a **pre-design stub**. No oracle functionality is active in production builds. The infrastructure (types, storage, validation stubs) is in place to support future activation after completing the required reviews listed in this document.

---

## ⚠️  Activation Requirements

**The `experimental` feature MUST NOT be enabled in production until ALL of the following are completed:**

| Requirement | Status | Notes |
|-------------|--------|-------|
| Cryptographic Design Review | ⬜ Required | Signature schemes, replay protection |
| Game-Theoretic Analysis | ⬜ Required | Oracle incentivization, sybil resistance |
| Legal / Compliance Review | ⬜ Required | Regulatory classification |
| Security Audit | ⬜ Required | By qualified Soroban auditors |
| Formal Verification | ⬜ Recommended | For critical financial logic |

---

## 1. Cryptographic Design Requirements

### 1.1 Signature Scheme

**REQUIRED:** Complete review before implementing signature verification.

Current stub implementation:
- `OracleTrigger.signature` field is reserved
- Non-empty signatures are **REJECTED** until crypto design is complete
- This is intentional to prevent accidental signature processing

#### Proposed Considerations (for future design):
- Ed25519 or EdDSA for efficient signature verification on Stellar
- Threshold signatures for multi-oracle consensus (e.g., 2-of-3)
- Hardware security module (HSM) integration for oracle key management

### 1.2 Replay Attack Prevention

**REQUIRED:** Nonce-based replay protection.

#### Design Requirements:
- Each oracle must maintain a monotonically increasing nonce
- Contract validates nonce freshness before accepting triggers
- Nonce validation window must be defined (e.g., ±5 minutes)

#### Storage for Replay Protection:
```
OracleNonce(oracle_address) → u64
```

### 1.3 Oracle Key Rotation

**REQUIRED:** Mechanism for rotating oracle signing keys.

#### Considerations:
- Time-delayed key rotation (old key valid for N blocks after rotation)
- Multi-sig admin control for emergency key revocation
- Key rotation event emission for off-chain monitoring

---

## 2. Game-Theoretic Requirements

### 2.1 Oracle Incentivization

**REQUIRED:** Design how honest oracle reporting is incentivized.

#### Questions to Resolve:
1. How are oracles compensated for reporting?
2. What happens if an oracle goes offline?
3. How is reporting latency handled?

#### Proposed Models (for evaluation):
- **Bonded Oracle Model:** Oracles stake tokens as collateral
- **Subscription Model:** Insurance pool pays oracle fees
- **Reputation Model:** Economic incentive through reputation scoring

### 2.2 Sybil Resistance

**REQUIRED:** Prevent malicious actors from creating fake oracles.

#### Design Considerations:
- Oracle registration requires economic stake
- Slashing conditions for malicious behavior
- Reputation-based oracle scoring
- Minimum number of independent oracles per data source

### 2.3 Collusion Detection

**RECOMMENDED:** Detect and penalize oracle collusion.

#### Potential Mechanisms:
- Statistical anomaly detection for suspicious agreement rates
- Slash-and-jail for colluding oracles
- Delayed settlement to allow fraud detection

---

## 3. Legal / Compliance Requirements

### 3.1 Regulatory Classification

**REQUIRED:** Legal review of parametric insurance classification.

#### Key Questions:
1. How is parametric insurance classified in target jurisdictions?
2. Does auto-triggered payout require insurance licensing?
3. What disclosures are required to policyholders?
4. Are there capital reserve requirements?

### 3.2 Smart Contract-Triggered Payouts

**REQUIRED:** Legal review of automated claim processing.

#### Considerations:
- Jurisdictional restrictions on algorithmic claims processing
- Policyholder notification requirements
- Dispute resolution mechanisms for contested triggers
- Audit trail requirements for regulatory examination

### 3.3 AML/KYC Considerations

**REQUIRED:** Review of anti-money laundering requirements.

#### Questions:
1. Do oracle attestations trigger AML monitoring?
2. Are there reporting requirements for automated payouts?
3. What is the KYC flow for parametric policyholders?

---

## 4. Technical Design

### 4.1 Trigger Lifecycle

```
┌─────────────┐
│  Trigger     │
│  Submitted   │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Validation │ ◄── Non-crypto checks (implemented)
│  (Pending)  │ ◄── Signature verification (TBD)
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌─────────────┐
│  Validated  │────►│  Rejected   │ (invalid trigger)
└──────┬──────┘     └─────────────┘
       │
       ▼
┌─────────────┐
│  Executed   │ ◄── Automatic payout initiation
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Complete   │
└─────────────┘
```

### 4.2 Storage Schema (Post-Activation)

```rust
// Storage keys (defined in storage.rs, gated by experimental feature)

TriggerCounter       → u64           // Global monotonic ID
OracleTrigger(id)    → OracleTrigger // Trigger record
TriggerStatus(id)   → TriggerStatus  // Lifecycle state
OracleWhitelist     → Vec<Address>   // Authorized oracles
OracleEnabled       → bool           // Global toggle (default: false)
OracleConfig        → OracleConfig   // Future: thresholds, windows, etc.
```

### 4.3 Event Types (Stub)

| Event Type | Description | Data Payload |
|------------|-------------|--------------|
| `Undefined` | Pre-configuration stub | Empty |
| `WeatherEvent` | Weather station data | Event code, value, unit |
| `FlightCancellation` | Flight disruption | Flight ID, airport codes |
| `PriceDeviation` | Asset price movement | Asset, deviation basis points |

---

## 5. Security Invariants

The following invariants MUST be maintained:

### 5.1 Default Build Inertness
- ✅ Default builds (without `experimental`) **cannot** process oracle triggers
- ✅ Default builds **panic** if oracle storage functions are called
- ✅ Tests verify this behavior

### 5.2 Explicit Enable Required
- ✅ `OracleEnabled` storage defaults to `false`
- ✅ Admin must explicitly enable after completing all reviews
- ✅ Toggle can be turned off for emergency circuit-breaker

### 5.3 Signature Safety
- ✅ Non-empty signatures are rejected until crypto review
- ✅ This prevents accidental signature parsing
- ⚠️  MUST implement proper signature verification before activation

### 5.4 No Unsafe Parsing
- ⚠️  **DO NOT parse untrusted signatures without complete crypto design review**
- ⚠️  **DO NOT implement signature verification without audit**

---

## 6. Testing Requirements

### 6.1 Default Build Tests (Implemented)
- ✅ `is_oracle_enabled` panics in default builds
- ✅ `set_oracle_enabled` panics in default builds
- ✅ All oracle storage functions panic in default builds
- ✅ All oracle validation functions panic in default builds

### 6.2 Experimental Build Tests (Implemented)
- ✅ Oracle disabled by default
- ✅ Oracle can be enabled/disabled by admin
- ✅ Trigger ID generation works
- ✅ Trigger storage and retrieval works
- ✅ Validation rejects disabled oracle
- ✅ Validation rejects expired triggers
- ✅ Validation rejects non-empty signatures
- ✅ Status transition validation works

### 6.3 Future Test Requirements
- ⬜ Signature verification tests (post-crypto-design)
- ⬜ Multi-oracle quorum tests
- ⬜ Replay attack prevention tests
- ⬜ Oracle key rotation tests

---

## 7. UI / UX Coordination

### 7.1 Frontend Labeling Requirements

**All oracle/parametric automation UI elements MUST be labeled as:**

```
⚠️ EXPERIMENTAL - NOT FOR PRODUCTION USE
```

**Required labels:**
- Oracle configuration screens
- Parametric trigger configuration
- Automatic claim settings
- Any UI showing oracle data

**Documentation requirements:**
- Link to this design document
- Clear explanation that automation is not live
- Contact information for production interest

### 7.2 CI/CD Requirements

**Experimental builds should be:**
- Isolated in separate CI jobs
- Clearly labeled as experimental
- NOT deployed to production environments
- Require explicit approval to run

---

## 8. Future Work

### Phase 1: Core Infrastructure (Current - Stub)
- [x] Oracle types and storage (stub)
- [x] Feature flagging
- [x] Panic-mode safety
- [x] Basic validation stubs

### Phase 2: Cryptographic Design (Required)
- [ ] Complete crypto design review
- [ ] Implement signature verification
- [ ] Implement nonce/replay protection
- [ ] Security audit

### Phase 3: Game-Theoretic Design (Required)
- [ ] Oracle incentivization model
- [ ] Sybil resistance mechanism
- [ ] Collusion detection

### Phase 4: Legal/Compliance (Required)
- [ ] Regulatory classification review
- [ ] Smart contract payout legal review
- [ ] AML/KYC assessment

### Phase 5: Implementation
- [ ] Implement trigger-to-claim flow
- [ ] Implement parametric payout calculation
- [ ] Implement multi-oracle consensus
- [ ] Implement admin configuration UI
- [ ] Full security audit

### Phase 6: Production
- [ ] Enable experimental feature in staging
- [ ] Integrate with legal-approved oracle sources
- [ ] Gradual rollout with monitoring
- [ ] Incident response plan

---

## 9. Contact & Reviews

### Required Sign-offs Before Activation

| Role | Review | Sign-off |
|------|--------|----------|
| Cryptographer | Signature scheme, replay protection | ⬜ Pending |
| Game Theorist | Oracle incentives, sybil resistance | ⬜ Pending |
| Legal Counsel | Regulatory classification | ⬜ Pending |
| Compliance | AML/KYC requirements | ⬜ Pending |
| Security Auditor | Full smart contract audit | ⬜ Pending |
| Smart Contract Lead | Technical implementation | ⬜ Pending |

---

## 10. References

- [Stellar Soroban Documentation](https://soroban.stellar.org/)
- [Parametric Insurance Overview](https://en.wikipedia.org/wiki/Parametric_insurance)
- [Oracle Attack Vectors](https://blog.chain.link/oracle-attack-vectors/)
- [Verifiable Random Functions](https://en.wikipedia.org/wiki/Verifiable_random_function)

---

**Document Version:** 0.1.0  
**Last Updated:** 2026-03-25  
**Status:** PRE-REVIEW (DO NOT USE FOR PRODUCTION)
