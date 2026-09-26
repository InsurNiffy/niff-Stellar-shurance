# On-Call Runbook Index

A single entry point for on-call engineers to quickly find the right incident runbook during an outage.

Use this index when an incident is declared — scan by **symptom**, find the matching runbook, and follow the step-by-step procedures.

---

## By Symptom / Affected System

### Database & Data Loss

- **[Disaster Recovery Runbook](./disaster-recovery-runbook.md)** — *PostgreSQL restore failed, data loss suspected, RTO/RPO breach*
  PostgreSQL backup restoration, RPO/RTO targets, Redis loss windows, partial vs total loss response, step-by-step restore procedures, and quarterly drill checklists.

- **[Privacy & Data Retention Runbook](./privacy-runbook.md)** — *User data deletion request, compliance hold, retention policy question*
  Soft-delete behavior, data retention windows, appeal records purge, GDPR right-to-erasure process, SLA acknowledgement, and immutability limits (on-chain data, IPFS).

### Job Queue & Async Processing

- **[Queue Replay Runbook](./queue-replay-runbook.md)** — *DLQ depth alert, failed jobs stuck, notifications not sending, indexer backlog*
  Identifies affected queue (indexer, notifications, claim-events, reindex), inspects failed jobs via Bull Board, determines replay eligibility, and replays via API / Bull Board UI / Redis CLI.

### Smart Contract & Chain Operations

- **[Stellar Testnet Reset Recovery Runbook](./stellar-testnet-reset-recovery.md)** — *Testnet ledger reset announced, contract IDs invalid, RPC returns "ledger not found"*
  Detection signals, stop-the-indexer, fund accounts via Friendbot, rebuild and deploy WASM, reset indexer cursors, re-seed test data, and smoke-test procedures.

- **[Operational Maintenance Runbook](./maintenance-runbook.md)** — *WASM drift alert, contract upgrade pending, emergency pause required*
  WASM drift detection and response, dependency audit / supply-chain findings, indexer reindex procedure, contract upgrade step-by-step, emergency pause for claims/policies, and permissionless keeper monitoring.

- **[Secrets Management Runbook](./secrets-management-runbook.md)** — *Secret rotation overdue, suspected credential leak, JWT key mismatch*
  Required secret inventory with rotation frequency, zero-downtime JWT rotation, database credentials, IPFS tokens, RPC keys, admin token, webhook secrets, and suspected leak response playbook.

### API & User-Facing Errors

- **[Error & Support Playbook](./error-support-playbook.md)** — *User reports error, "ref: REQ-123" in UI, API returns 5xx, Stellar transaction failed*
  Correlation ID lookup, structured log retrieval (Grafana / Loki), error code reference (auth, wallet, transaction, contract, policy, claims, rate limiting), Stellar transaction debugging, and Tier 1/2/3 escalation matrix.

---

## How to Add a New Incident Runbook

When adding a runbook for a new symptom or incident type:

1. **Write the runbook** following the structure and conventions established by existing runbooks:
   - Include an **Overview** section briefly describing what the runbook covers.
   - Include an **Owner** (team responsible) and **Review cadence** (how often it should be reviewed).
   - Use step-by-step **procedures** with numbered sections, commands, and expected outcomes.
   - Include **smoke tests** or **verification steps** to confirm resolution.
   - Cross-link to related runbooks using `[Title](./file.md)`.

2. **Add an entry to this index** under the appropriate **symptom category** above:
   - Use the format: `**[Title](./file.md)** — *Symptom keywords or incident trigger*`
     Include one line describing when to reach for this runbook.

3. **Link from on-call onboarding** (if the new runbook is discovery-critical):
   - Refer to the [Linking from On-Call Onboarding](#linking-from-on-call-onboarding) section below.

4. **Submit a PR** with:
   - The new runbook file(s)
   - This `README.md` updated with the new entry
   - Any on-call onboarding updates (if applicable)

### Example runbook frontmatter

```markdown
# [Incident Topic] Runbook

**Owner:** [Team responsible]
**Primary responders:** [Roles, e.g., Backend on-call, DBA/Ops, Incident Commander]
**Review cadence:** [Quarterly, after every incident, after every release, etc.]

---

## Overview

Brief description of the scope.

---

## Detection

How to know an incident matching this runbook has occurred.

---

## Step-by-step Procedure

### 1. [First major step]
Owner: [Role]
...
```

---

## Linking from On-Call Onboarding

New on-call engineers discover runbooks through the following onboarding materials:

- **[CONTRIBUTING.md](../../CONTRIBUTING.md)** — Developer onboarding guide
  Added link: *"Ops — See [On-Call Runbook Index](./docs/ops/README.md) for incident response procedures."*

- **[docs/FIRST_WEEK_CHECKLIST.md](../FIRST_WEEK_CHECKLIST.md)** — Contributor setup checklist
  May link if on-call is part of the first-week rotation; currently focused on development environment setup.

When adding a discovery-critical runbook (e.g., a runbook for a frequent or high-severity incident), add a brief pointer in CONTRIBUTING.md's ops/on-call section so it's findable before an incident happens.

---

## Acceptance Criteria

This runbook index satisfies [Issue #1174](https://github.com/InsurNiffy/niff-Stellar-shurance/issues/1174) — *On-call runbook index: single entry point linking all incident runbooks* — by:

- ✅ Enumerating every existing runbook in the repo
- ✅ Organizing by symptom / affected system (not alphabetically)
- ✅ Linking each runbook with a one-line description of when to use it
- ✅ Documenting the process for adding new runbooks
- ✅ Linking from on-call onboarding materials (CONTRIBUTING.md)
- ✅ Confirming no conflicts with existing ops documentation

---

## Review and Maintenance

- **Cadence:** Review this index quarterly and after every new incident runbook is merged.
- **Update trigger:** When a new runbook is committed, this index must be updated in the same PR.
- **Audit:** Ensure the symptom categories remain grounded in real runbook content; remove or rename categories that no longer apply.
