# Appeal Incident Runbook

> Last verified: 2026-08-29 by appeal-ops-batch

## Owner / Primary responders

| Role | Team |
|---|---|
| Primary | Backend on-call (keepers + indexer) |
| Secondary | Contract on-call (only if `finalize_appeal` itself fails) |
| Review cadence | Quarterly — see [runbook-review-cadence.md](./runbook-review-cadence.md) |

## Overview

An appeal round is **stuck** when a claim remains `UNDER_APPEAL` in Postgres (and
on-chain `UnderAppeal`) **after** `appeal_deadline_ledger` has passed, or when
chain and DB diverge mid-appeal (RPC outage, indexer lag, finalize keeper down).

Related tools from the appeal ops batch:

| Tool | Where | Use when |
|---|---|---|
| **SLA / deadline monitor** | Claim deadline processor + Prometheus appeal/finalize metrics (`backend/docs/observability.md`, `prometheus-rules.yml`) | Detect appeals past deadline or keeper silence |
| **Admin force-finalize** | `POST /api/admin/claims/:id/finalize-appeal` | Keeper failed; deadline passed; need permissionless finalize on behalf of ops |
| **Vote reconciliation job** | `ReconciliationService` (cron every 5 min) | Tallies on the claim row disagree with vote rows (display / finalize readiness) |
| **Indexer / queue replay** | [queue-replay-runbook.md](./queue-replay-runbook.md) | Events ingested but Claim row not updated |

Cross-links: escalation matrix in [error-support-playbook.md](./error-support-playbook.md) §5;
keepers / `process_deadline` in [maintenance-runbook.md](./maintenance-runbook.md) §6.

---

## 1. Identify a stuck appeal

### Symptoms

| Symptom | Likely cause |
|---|---|
| UI / API still `UNDER_APPEAL` well past deadline | Finalize keeper down or never invoked |
| On-chain `AppealApproved`/`AppealRejected` but DB still `UNDER_APPEAL` or `REJECTED` | Indexer lag or missing appeal decode |
| Appeal submitted on-chain; UI still `REJECTED` | Indexer lag on `AppealOpened` / `claim_status_changed` |
| Vote counts look wrong while `UNDER_APPEAL` | Reconciliation discrepancy |

### Quick checks

```bash
# Claim row
psql "$DATABASE_URL" -c "
  SELECT id, status, appeals_count, appeal_tx_hash, is_finalized,
         approve_votes, reject_votes, updated_at_ledger, updated_at
  FROM claims WHERE id = <CLAIM_ID>;
"

# Indexer lag (replace network)
psql "$DATABASE_URL" -c "
  SELECT network, last_processed_ledger, updated_at FROM ledger_cursors;
"

# Recent appeal-related raw events
psql "$DATABASE_URL" -c "
  SELECT tx_hash, event_index, ledger, topic1, topic2, topic3, created_at
  FROM raw_events
  WHERE topic2 IN ('appeal_opened','appeal_resolved','claim_status_changed')
    AND (topic3::text = '<CLAIM_ID>' OR data::text LIKE '%claim_id%: <CLAIM_ID>%')
  ORDER BY ledger DESC
  LIMIT 20;
"
```

Prometheus (examples):

```promql
# Indexer / finalize health — see backend/docs/prometheus-rules.yml
increase(niffy_appeal_opened_total[1h])
increase(niffy_appeal_approved_total[1h])
bullmq_dlq_depth{app="niffyinsure-api",queue="indexer"}
```

Compare on-chain status via explorer or:

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$VIEW_KEY" \
  --network "$STELLAR_NETWORK" \
  -- get_claim --claim_id <CLAIM_ID>
```

Note `status`, `appeal_deadline_ledger`, and current ledger.

---

## 2. Triage decision tree

| Condition | Action |
|---|---|
| Current ledger **≤** `appeal_deadline_ledger` | **Not stuck** — wait for voting; no force-finalize |
| Deadline passed; on-chain still `UnderAppeal`; keeper silent | **Force-finalize** (section 3) |
| On-chain already terminal; DB not | **Indexer recovery** (section 4) |
| DB tallies ≠ vote row counts | **Reconciliation** (section 5) |
| RPC / Horizon outage mid-appeal | Wait for RPC; then re-check chain vs DB; do not double-submit appeals |

---

## 3. Recover with admin force-finalize

**Prerequisites:** admin JWT; claim `UNDER_APPEAL` in API; deadline passed (or incident override approved); incident channel open.

```bash
curl -X POST "https://<host>/api/admin/claims/<CLAIM_ID>/finalize-appeal" \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json"
```

Expect `200` with a tx hash. Then:

1. Confirm on-chain status moved to `AppealApproved` or `AppealRejected`.
2. Wait for indexer (or trigger reindex of that ledger range) until DB status is
   `APPEAL_APPROVED` / `APPEAL_REJECTED`.
3. If API returns `CLAIM_NOT_UNDER_APPEAL`, re-check DB — may already be resolved
   or never opened.

Do **not** use force-finalize as a substitute for fixing a down keeper long-term;
file a keeper follow-up after the incident.

---

## 4. Recover indexer lag / missed appeal decode

1. Check DLQ / failed indexer jobs — [queue-replay-runbook.md](./queue-replay-runbook.md).
2. Confirm decode path covers `niffyinsure`/`appeal_opened`, `appeal_resolved`, and
   `niffyins`/`claim_status_changed` with `UnderAppeal` / `AppealApproved` /
   `AppealRejected` (see indexer service).
3. If raw_events exist but claim row stale, reindex the ledger window for the
   appeal tx (admin reindex) rather than hand-editing status.
4. Optimistic API write may already have set `UNDER_APPEAL` + `appeals_count`;
   indexer must not double-increment — verify `appeals_count` stays coherent.

---

## 5. Vote reconciliation

When finalize looks blocked by bad tallies:

```bash
# Admin / internal: last reconciliation result is exposed by ReconciliationService
# Cron runs every 5 minutes and repairs approve_votes / reject_votes from vote rows.
```

1. Confirm `ReconciliationService` last run (logs: `Starting vote tally reconciliation`).
2. For a single claim, compare stored tallies vs `votes` counts.
3. After repair, retry permissionless `finalize_appeal` or admin force-finalize.

---

## 6. RPC outage mid-appeal

1. Pause client retries that would re-submit a different `txHash` (idempotency is
   per `appealTxHash`).
2. When RPC recovers, check whether the original appeal tx made it on-chain.
3. If on-chain open succeeded but API never recorded it, rely on indexer
   `AppealOpened` decode to set `UNDER_APPEAL` / `appealsCount`.
4. If tx never landed, claimant may rebuild + submit once (new txHash).

---

## 7. Verification

- [ ] On-chain claim status matches expected terminal or open state
- [ ] `claims.status` and `appeals_count` match chain / API expectations
- [ ] Appeal metrics incremented appropriately (no obvious double-count spike)
- [ ] Keeper / finalize path healthy or ticket filed
- [ ] Incident notes link this runbook + claim id + tx hashes

## Escalation

| Failure | Escalate to |
|---|---|
| Force-finalize / `finalize_appeal` reverts | Contract on-call |
| Persistent indexer gap | Backend on-call + platform |
| Data corruption / wrong `appeals_count` | Backend + include reconciliation output |

See also [error-support-playbook.md](./error-support-playbook.md) appeal escalation matrix.
