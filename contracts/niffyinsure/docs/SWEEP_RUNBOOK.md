# Emergency Token Sweep Runbook

## Overview

The emergency token sweep function (`sweep_token`) allows authorized administrators to recover tokens that were mistakenly sent to the NiffyInsure contract. This document provides operational guidance, legal requirements, and ethical constraints for using this high-risk function.

## ⚠️ Critical Warning

**This function must NEVER be used to:**
- Confiscate user entitlements or premium payments
- Avoid paying approved claims
- Seize funds that belong to policyholders
- Circumvent normal protocol operations

Misuse of this function will result in:
- Irreparable reputational damage
- Potential legal liability
- Loss of user trust
- Regulatory scrutiny

## When Sweep is Permissible

### Legitimate Use Cases (Reason Codes)

| Code | Scenario | Example | Risk Level |
|------|----------|---------|------------|
| 1 | Accidental user transfer | User sends tokens to contract address instead of their wallet | Low |
| 2 | Test tokens on mainnet | Test tokens accidentally sent to production contract | Low |
| 3 | Unsolicited airdrops | Third-party airdrop tokens not part of protocol | Low |
| 4 | Deprecated asset migration | Moving funds from deprecated token to new version | Medium |
| 5-99 | Reserved | Future protocol-defined scenarios | TBD |
| 100+ | Custom organizational | Organization-specific codes (document internally) | Varies |

### When Sweep is NOT Permissible

❌ **Never sweep when:**
- Tokens represent user premium payments
- Tokens are needed for approved claim payouts
- Tokens are part of protocol treasury reserves
- Origin of tokens is unclear or disputed
- Legal ownership is contested
- Regulatory investigation is ongoing

## Pre-Sweep Checklist

Before executing a sweep operation, complete ALL of the following:

### 1. Investigation Phase

- [ ] Identify the source of the tokens (blockchain explorer, transaction hash)
- [ ] Verify tokens are NOT user premiums or claim funds
- [ ] Check if tokens are part of an airdrop or promotional campaign
- [ ] Review recent contract transactions for context
- [ ] Document findings in incident report

### 2. Authorization Phase

- [ ] Obtain approval from at least 3 authorized signers (multisig)
- [ ] Document business justification with reason code
- [ ] Verify no open claims would be affected
- [ ] Confirm sufficient reserves remain after sweep
- [ ] Legal/compliance review completed (if required by policy)

### 3. Technical Validation

- [ ] Verify asset is allowlisted
- [ ] Check current sweep cap (if configured)
- [ ] Calculate protected balance (approved claims)
- [ ] Confirm sweep amount leaves adequate reserves
- [ ] Test sweep on testnet with similar conditions (if time permits)

### 4. Communication Phase

- [ ] Notify relevant stakeholders (if material amount)
- [ ] Prepare public transparency statement (if required)
- [ ] Update internal audit log
- [ ] Schedule post-sweep verification

## Execution Procedure

### Step 1: Gather Information

```bash
# Get contract balance for asset
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_ACCOUNT> \
  --network mainnet \
  -- \
  get_balance \
  --asset <ASSET_ADDRESS>

# Check protected balance (approved claims)
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_ACCOUNT> \
  --network mainnet \
  -- \
  get_claim_counter

# Review each claim status
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_ACCOUNT> \
  --network mainnet \
  -- \
  get_claim \
  --claim_id <CLAIM_ID>
```

### Step 2: Calculate Safe Sweep Amount

```
Safe Sweep Amount = Current Balance - Protected Balance - Safety Buffer

Where:
- Current Balance: Total tokens in contract
- Protected Balance: Sum of all approved (unpaid) claims
- Safety Buffer: 10-20% reserve for operational needs (recommended)
```

**Example:**
```
Current Balance:    1,000,000 tokens
Approved Claims:      600,000 tokens
Safety Buffer (15%):  150,000 tokens
─────────────────────────────────────
Safe Sweep Amount:    250,000 tokens
```

### Step 3: Configure Sweep Cap (Optional but Recommended)

```bash
# Set per-transaction cap (e.g., 100,000 tokens)
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_MULTISIG> \
  --network mainnet \
  -- \
  set_sweep_cap \
  --cap 100000000000  # Amount in stroops (7 decimals)
```

### Step 4: Execute Sweep

```bash
# Execute sweep with multisig authorization
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_MULTISIG> \
  --network mainnet \
  -- \
  sweep_token \
  --asset <ASSET_ADDRESS> \
  --recipient <DESTINATION_ADDRESS> \
  --amount <AMOUNT_IN_STROOPS> \
  --reason_code <CODE>
```

### Step 5: Verify and Document

```bash
# Verify sweep completed
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_ACCOUNT> \
  --network mainnet \
  -- \
  get_balance \
  --asset <ASSET_ADDRESS>

# Check event emission
stellar events \
  --id <CONTRACT_ID> \
  --network mainnet \
  --filter "emergency_sweep"
```

## Post-Sweep Actions

### Immediate (Within 1 hour)

1. Verify destination received tokens
2. Update internal audit log with:
   - Transaction hash
   - Amount swept
   - Reason code
   - Approving signers
   - Timestamp
3. Confirm remaining balance covers all obligations

### Short-term (Within 24 hours)

1. Review event logs for anomalies
2. Notify finance/accounting team
3. Update treasury reconciliation
4. File incident report (if required)

### Long-term (Within 1 week)

1. Conduct post-mortem if sweep was due to operational error
2. Update procedures to prevent recurrence
3. Review and adjust sweep cap if needed
4. Compliance review (if material amount)

## Protected Balance Calculation

The contract automatically calculates protected balance as:

```rust
protected_balance = sum(approved_claims.amount) where claim.status == Approved
```

### What is Protected

✅ **Protected (cannot sweep):**
- Approved claims awaiting payout
- Claims in "Approved" status

### What is NOT Protected

⚠️ **Not automatically protected (requires manual judgment):**
- Premium reserves (operational float)
- Claims in "Processing" status (not yet approved)
- Future claim obligations (not yet filed)
- Protocol treasury reserves

**Operators MUST maintain adequate reserves beyond the protected balance to ensure protocol solvency.**

## Residual Risk Disclosure

### Limitations of Protected Balance Check

The contract **cannot perfectly distinguish** between:
- Legitimate premium reserves
- Stray tokens (accidental transfers)
- Operational float needed for day-to-day operations

### Risk Mitigation

1. **Safety Buffer**: Always leave 10-20% buffer above protected balance
2. **Treasury Monitoring**: Track premium inflows vs. claim outflows
3. **Regular Audits**: Monthly reconciliation of expected vs. actual reserves
4. **Conservative Sweeps**: When in doubt, sweep less rather than more

### Example Risk Scenario

```
Scenario: Contract holds 1M tokens
- Approved claims: 400K (protected)
- Recent premiums: 300K (not distinguishable)
- Stray airdrop: 300K (target for sweep)

Risk: Sweeping 300K might inadvertently take premium reserves
Mitigation: Sweep only 200K, leaving 100K buffer
```

## Multisig Requirements

### Production Mainnet

**REQUIRED:** 3-of-5 multisig or stronger

- Minimum 3 signers required for sweep execution
- Signers should be from different organizational roles:
  - Technical lead
  - Finance/treasury
  - Legal/compliance
  - Operations
  - Executive sponsor

### Testnet

**RECOMMENDED:** 2-of-3 multisig

- Allows testing of multisig workflows
- Reduces operational friction for testing

### Multisig Setup (Stellar)

```bash
# Create multisig account
stellar keys generate multisig-admin

# Configure signers and thresholds
stellar account set-options \
  --source <ADMIN_ACCOUNT> \
  --signer <SIGNER_1_PUBLIC_KEY>:1 \
  --signer <SIGNER_2_PUBLIC_KEY>:1 \
  --signer <SIGNER_3_PUBLIC_KEY>:1 \
  --signer <SIGNER_4_PUBLIC_KEY>:1 \
  --signer <SIGNER_5_PUBLIC_KEY>:1 \
  --low-threshold 3 \
  --med-threshold 3 \
  --high-threshold 3
```

## Legal & Compliance Requirements

### Regulatory Classification

The emergency sweep is classified as an **administrative recovery of non-custodial funds**.
It is NOT a payment service, money transmission, or investment activity under the following frameworks:

| Jurisdiction | Classification | Key Basis |
|---|---|---|
| United States | Non-custodial administrative recovery | Not a "transmission" of user funds; no FinCEN MSB trigger |
| European Union | Protocol maintenance (MiCA Art. 76) | Not a payment service; no PSD2 trigger |
| United Kingdom | Administrative function | Not a regulated payment; FCA cryptoasset registration may apply |

> ⚠️ These classifications are preliminary. Each deployment **MUST** obtain independent
> legal sign-off. See `SWEEP_LEGAL_COMPLIANCE.md` for the full sign-off record.

### Two-Step Confirmation Requirement (Issue #007)

All sweep operations **MUST** use the two-step admin confirmation flow:

**Step 1 — Propose** (first admin signer):
```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_SIGNER_1> \
  --network mainnet \
  -- \
  propose_admin_action \
  --action '{"TokenSweep":{"asset":"<ASSET_ADDRESS>","recipient":"<RECIPIENT>","amount":<AMOUNT>,"reason_code":<CODE>}}'
```

**Step 2 — Confirm** (second admin signer, ≠ proposer, after notice period):
```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_SIGNER_2> \
  --network mainnet \
  -- \
  confirm_admin_action
```

**Notice period:** The contract enforces a configurable on-chain delay between proposal
and execution (`SweepNoticePeriodLedgers`). The recommended mainnet value is **2880 ledgers
(~4 hours at 5 s/ledger)**. Set via:
```bash
stellar contract invoke -- set_sweep_notice_period --ledgers 2880
```

**Cancellation** (proposer only, before expiry):
```bash
stellar contract invoke -- cancel_admin_action
```

> The single-step `sweep_token` entrypoint remains available for emergency use but
> **SHOULD NOT** be used in normal operations. Prefer the two-step flow for all sweeps.

### Before Mainnet Enablement

- [ ] Legal review of sweep function and custody implications
- [ ] Compliance sign-off on operational procedures
- [ ] Document sweep policy in Terms of Service
- [ ] Establish internal approval workflow
- [ ] Define materiality thresholds for external disclosure

### Ongoing Requirements

- [ ] Maintain audit log of all sweep operations
- [ ] Quarterly review of sweep usage
- [ ] Annual legal/compliance re-certification
- [ ] Incident reporting for material sweeps (define threshold)

### Recommended Materiality Thresholds

| Amount (USD) | Disclosure Requirement |
|--------------|------------------------|
| < $1,000 | Internal log only |
| $1,000 - $10,000 | Internal review + stakeholder notification |
| $10,000 - $100,000 | Public transparency report |
| > $100,000 | Immediate public disclosure + regulatory notification |

## Transparency & Communication

### Public Transparency Statement Template

```markdown
## Emergency Token Sweep Notification

**Date:** [YYYY-MM-DD]
**Transaction Hash:** [STELLAR_TX_HASH]
**Asset:** [ASSET_CODE]
**Amount:** [AMOUNT] [ASSET_CODE]
**Reason:** [REASON_DESCRIPTION]

### Background
[Explain how tokens ended up in contract]

### Justification
[Explain why sweep was necessary and appropriate]

### Impact
- No user funds affected
- No approved claims affected
- Protocol operations continue normally

### Verification
Users can verify this transaction on [Stellar Explorer Link]
```

## Monitoring & Alerting

### Recommended Alerts

1. **Sweep Execution Alert**
   - Trigger: Any sweep_token call
   - Notify: All admin signers + operations team
   - Include: Amount, asset, reason code, transaction hash

2. **Large Sweep Alert**
   - Trigger: Sweep amount > configured threshold
   - Notify: Executive team + legal/compliance
   - Require: Additional approval step

3. **Protected Balance Violation Attempt**
   - Trigger: Sweep attempt that would violate protected balance
   - Notify: Security team + operations
   - Action: Investigate potential compromise

### Event Monitoring

```bash
# Monitor sweep events in real-time
stellar events stream \
  --id <CONTRACT_ID> \
  --network mainnet \
  --filter "emergency_sweep" \
  | jq '.data'
```

## Incident Response

### If Unauthorized Sweep Detected

1. **Immediate Actions (< 5 minutes)**
   - Pause contract if possible
   - Notify all admin signers
   - Document transaction details
   - Assess impact on user funds

2. **Short-term Actions (< 1 hour)**
   - Investigate how unauthorized access occurred
   - Rotate admin keys if compromised
   - Assess legal/regulatory obligations
   - Prepare public statement

3. **Long-term Actions (< 24 hours)**
   - File incident report
   - Notify affected users (if any)
   - Regulatory notification (if required)
   - Implement additional controls

### If Sweep Violates User Entitlements

1. **Immediate Remediation**
   - Return swept funds to contract
   - Process affected claims immediately
   - Notify affected users

2. **Root Cause Analysis**
   - Identify procedural failure
   - Update runbook to prevent recurrence
   - Retrain operators

3. **Accountability**
   - Document lessons learned
   - Update approval workflows
   - Consider additional safeguards

## Testing & Validation

### Testnet Testing Checklist

Before using sweep on mainnet, validate on testnet:

- [ ] Admin-only access control works
- [ ] Non-admin callers are rejected
- [ ] Amount validation (zero, negative)
- [ ] Asset allowlist enforcement
- [ ] Sweep cap enforcement
- [ ] Protected balance calculation
- [ ] Event emission and indexing
- [ ] Multisig workflow
- [ ] Edge cases (exact balance, multiple sweeps)

### Mainnet Dry Run

Before first production sweep:

1. Review all checklist items
2. Simulate sweep calculation with real data
3. Verify multisig signing process
4. Prepare rollback plan (if needed)
5. Schedule during low-activity period

## Appendix A: Reason Code Registry

Maintain an internal registry of reason codes used:

| Code | Date First Used | Description | Frequency | Notes |
|------|-----------------|-------------|-----------|-------|
| 1 | 2024-01-15 | Accidental user transfer | 3 times | Most common |
| 2 | 2024-02-01 | Test tokens | 1 time | Testnet leak |
| 3 | 2024-03-10 | Airdrop tokens | 2 times | Marketing campaigns |
| 100 | 2024-04-05 | Custom: Migration | 1 time | Protocol upgrade |

## Appendix B: Contact Information

### Emergency Contacts

- **Technical Lead:** [NAME] - [EMAIL] - [PHONE]
- **Legal/Compliance:** [NAME] - [EMAIL] - [PHONE]
- **Finance/Treasury:** [NAME] - [EMAIL] - [PHONE]
- **Executive Sponsor:** [NAME] - [EMAIL] - [PHONE]

### Escalation Path

1. Operations Team → Technical Lead (< 15 min)
2. Technical Lead → Executive Sponsor (< 1 hour)
3. Executive Sponsor → Legal/Compliance (< 4 hours)
4. Legal/Compliance → External Counsel (as needed)

## Appendix C: Audit Log Template

```json
{
  "sweep_id": "SWEEP-2024-001",
  "timestamp": "2024-03-27T10:30:00Z",
  "transaction_hash": "abc123...",
  "asset": "USDC:GBBD...",
  "amount": "250000.0000000",
  "recipient": "GABC...",
  "reason_code": 1,
  "reason_description": "Accidental user transfer",
  "approvers": [
    "alice@example.com",
    "bob@example.com",
    "charlie@example.com"
  ],
  "protected_balance_at_sweep": "600000.0000000",
  "remaining_balance_after_sweep": "750000.0000000",
  "safety_buffer_percentage": 15.0,
  "incident_report_id": "INC-2024-042",
  "legal_review_required": false,
  "public_disclosure_required": false
}
```

## Document Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2024-03-27 | [AUTHOR] | Initial version |

---

**Last Updated:** 2024-03-27  
**Next Review Date:** 2024-06-27  
**Document Owner:** [ROLE/TEAM]
