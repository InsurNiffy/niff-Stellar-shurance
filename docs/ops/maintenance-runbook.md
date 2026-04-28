# Operational Maintenance Runbook

**Owner:** Engineering + Legal + Ops  
**Review cadence:** Quarterly (align with backup drill — see backup issue)  
**Last signed off:** _YYYY-MM-DD — replace before first production use_

---

## 1. Wasm Drift Detection

See also **[secrets-management-runbook.md](./secrets-management-runbook.md)** for
secret ownership, rotation cadence, JWT key generation, and leak-response
steps.

### What it does
`WasmDriftService` runs every 6 hours. It fetches the on-chain wasm hash for each
contract listed in `contracts/deployment-registry.json`, compares it to the
`expectedWasmHash` field, and fires a webhook alert on mismatch.

Alerts are deduplicated via the `wasm_drift_alerts` table — one row per
`(contractName, actualHash)` pair. Repeated runs for the same unresolved drift
do not re-fire the webhook.

### Environment variables required

| Variable | Description |
|---|---|
| `CONTRACT_ID` | Deployed Soroban contract address |
| `NIFFYINSURE_EXPECTED_WASM_HASH` | SHA-256 hex of the authorised wasm build |
| `WASM_DRIFT_WEBHOOK_URL` | HTTPS endpoint to receive drift alerts (Slack/PagerDuty) |
| `WASM_DRIFT_WEBHOOK_SECRET` | Shared secret sent as `X-Webhook-Secret` header |
| `DEPLOYMENT_REGISTRY_PATH` | Path to registry JSON (default: `contracts/deployment-registry.json`) |

**Security:** `WASM_DRIFT_WEBHOOK_SECRET` must be stored in the secrets manager
(AWS Secrets Manager / GitHub Actions secrets). Never commit it to source.

### Updating the registry after a release
1. Run `sha256sum target/wasm32-unknown-unknown/release/niffyinsure.wasm`.
2. Update `NIFFYINSURE_EXPECTED_WASM_HASH` in the secrets manager.
3. Optionally update `contracts/deployment-registry.json` `deployedAt` field.
4. Mark the resolved `wasm_drift_alerts` row: `UPDATE wasm_drift_alerts SET resolved_at = NOW() WHERE contract_name = 'niffyinsure' AND resolved_at IS NULL;`

### Simulating drift in staging (acceptance criterion)
```bash
# Set NIFFYINSURE_EXPECTED_WASM_HASH to a known-wrong value, then trigger:
curl -X POST https://staging-api.example.com/admin/maintenance/check-wasm-drift \
  -H "Authorization: Bearer $ADMIN_JWT"
# Verify a row appears in wasm_drift_alerts and the webhook fires.
```

---

## 2. Dependency Audit / Supply-Chain

### CI policy
- **CRITICAL CVEs** → build fails immediately.
- **HIGH CVEs** → build passes with a `::warning` annotation; must be triaged within **7 days**.
- SBOMs (CycloneDX JSON) are uploaded as CI artifacts with 90-day retention.

### Override process for accepted risks
1. Engineer adds an entry to `docs/ops/audit-exceptions.md` with:
   - CVE ID, affected package, severity
   - Justification (e.g. not reachable in production code path)
   - Mitigations in place
   - Review-by date (max 90 days)
2. A second engineer approves the PR.
3. Apply the GitHub label `audit-exception-approved` to the failing PR.
4. Re-run the `dependency-audit` CI job.

### Emergency patch playbook
1. Identify the vulnerable package from `npm audit --json`.
2. Check for a patched version: `npm outdated <package>`.
3. If a patch exists: `npm update <package>` → open PR → fast-track review.
4. If no patch exists: assess exploitability; apply workaround or remove feature; open exception per above.
5. Notify security@ within 24 hours for CRITICAL findings.

---

## 3. Privacy Requests (Anonymization / Deletion)

See also **[privacy-runbook.md](./privacy-runbook.md)** for soft-delete behaviour, `DATA_RETENTION_DAYS`, and the scheduled purge of materialized rows (`raw_events` remains append-only).

### Scope and immutability limits

> **Do not promise on-chain erasure to users.**  
> On-chain policy and claim records written to the Stellar ledger are **permanently immutable**.  
> IPFS-pinned documents (claim images, policy metadata) are **content-addressed and cannot be deleted** from the public IPFS network; only local unpinning is possible.  
> This runbook covers **off-chain DB rows only**.

| Data location | Mutable? | Action available |
|---|---|---|
| PostgreSQL `claims` rows | Yes | Anonymize description/images or delete unfinalized rows |
| PostgreSQL `policies` rows | Yes | Anonymize (retain for audit); deletion requires legal sign-off |
| PostgreSQL `votes` rows | Yes (soft-delete) | Logical delete with policy; hard-delete after retention |
| PostgreSQL `raw_events` rows | No — audit integrity | Retained; not deleted |
| Stellar ledger (on-chain) | **Immutable** | None |
| IPFS-pinned files | **Immutable** (public network) | Local unpin only |

### SLAs

| Request type | Acknowledgement | Completion |
|---|---|---|
| Data export | 3 business days | 30 days |
| Anonymization | 3 business days | 30 days |
| Deletion | 3 business days | 30 days (off-chain only) |

Evidence of SLA compliance is recorded in the `privacy_requests` table
(`createdAt` → `completedAt` delta) and reviewed quarterly.

### Dry-run procedure (internal sign-off required before first production use)

```bash
# 1. Identify the subject wallet address from the support ticket.
WALLET="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

# 2. Preview rows that would be affected (read-only):
psql $DATABASE_URL -c "SELECT id, creator_address, description FROM claims WHERE creator_address = '$WALLET';"

# 3. Execute anonymization via admin API (requires admin JWT):
curl -X POST https://api.example.com/admin/privacy/requests \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d "{\"subjectWalletAddress\": \"$WALLET\", \"requestType\": \"ANONYMIZE\", \"notes\": \"User request #TICKET-123\"}"

# 4. Verify audit log entry:
curl https://api.example.com/admin/audits?action=privacy_anonymize \
  -H "Authorization: Bearer $ADMIN_JWT"

# 5. Confirm rows updated:
psql $DATABASE_URL -c "SELECT id, description FROM claims WHERE creator_address = '$WALLET';"
```

**Sign-off checklist (dry-run):**
- [ ] Dry-run executed in staging environment
- [ ] Audit log entry verified
- [ ] Affected row count matches expectation
- [ ] Legal/compliance officer reviewed output
- [ ] Runbook steps confirmed accurate — signed: _name, date_

### Deletion procedure notes
- Only **unfinalized** claims (`is_finalized = false`) are hard-deleted.
- Finalized claims are anonymized (description/images redacted) but the row is retained for regulatory audit purposes.
- Policy rows are never hard-deleted without explicit legal sign-off; use anonymization instead.

---

## 4. Quarterly Restore / Backup Drill

Cross-link: see **[disaster-recovery-runbook.md](./disaster-recovery-runbook.md)** for RPO/RTO targets, the full restore procedure, Redis loss windows, IAM scope, and quarterly ticket template.

Ops calendar entry: **first Monday of each quarter**.

Checklist:
- [ ] Restore latest DB backup to staging
- [ ] Verify `wasm_drift_alerts` and `privacy_requests` tables present and populated
- [ ] Re-run wasm drift check against staging contract
- [ ] Confirm audit log is append-only (attempt UPDATE/DELETE → expect permission denied)
- [ ] Record drill completion in ops calendar, [`recovery-drill-log.md`](./recovery-drill-log.md), and the quarterly drill ticket with timestamp and engineer sign-off

---

## 5. Compliance Processing Evidence

| Control | Evidence location | Frequency |
|---|---|---|
| Wasm drift check | `wasm_drift_alerts` table + webhook logs | Every 6 hours |
| Dependency audit | CI artifact `sbom-<sha>` | Every push |
| Privacy request SLA | `privacy_requests.completed_at - created_at` | Per request; reviewed quarterly |
| Backup/restore drill | Ops calendar + this runbook sign-off | Quarterly |
| Audit log integrity | `admin_audit_logs` (append-only, no UPDATE/DELETE grants) | Continuous |

---

## 6. Permissionless keepers (`process_expired` / `process_deadline`)

### What they do
- **`process_expired(holder, policy_id)`** — After ledger `>= end_ledger + grace_period_ledgers`, marks the policy inactive (if still active, no open claim), updates voter registry like a lapse, and emits `policy_expired`. **No signer required.** `holder` is only the storage key (same as `get_policy`).
- **`process_deadline(claim_id)`** — Same finalization rules as `finalize_claim` once `now > voting_deadline_ledger`, but only while the claim is still in base **`Processing`**; returns `CalculatorPaused` if `claims_paused` is set instead of panicking. **No signer required.**

Neither entrypoint can approve a claim without quorum math, change vote tallies, or pay out; they only apply deterministic transitions when on-chain conditions already hold.

### Recommended cadence
- **Claims:** Poll or stream ledgers; for each open claim with `voting_deadline_ledger < current_ledger`, submit `process_deadline`. Typical spacing: every ledger, or every 1–5 ledgers if batching simulations (~5 s target per ledger on Mainnet).
- **Policies:** For each tracked `(holder, policy_id)` (from indexer), call `process_expired` once `current_ledger >= end_ledger + grace`. Daily or weekly scans are enough if the indexer backfills; tighter cadence improves UI accuracy for "lapsed" state.

### Incentives
There is **no protocol reward** for keepers; operators run them to support product liveness (deadlines, lapsed flags) and their own UX. Use a dedicated funded account only for network fees.

### Failure modes
- `process_expired`: reverts with `PolicyLapseNotReached` until grace end; `OpenClaimsMustFinalize` if a claim is still open on that policy.
- `process_deadline`: reverts with `VotingWindowStillOpen` until after the voting deadline ledger; `ClaimAlreadyTerminal` if already finalized; `ClaimNotProcessing` if the claim left `Processing` without being terminal (e.g. appeal flows); `CalculatorPaused` while claims are paused (unlike `finalize_claim`, which panics on pause).

---

## 7. Indexer Reindex Procedure

Use this procedure when the indexer has missed ledgers, is significantly behind, or data integrity issues require a full replay from a known-good ledger.

### Prerequisites
- Admin access to the backend deployment environment
- `DATABASE_URL` and `SOROBAN_RPC_URL` env vars available
- Confirm the target start ledger with the team (check `indexer_cursors` table or last known-good checkpoint)

### Step-by-step

**1. Identify the gap**
```bash
# Check current indexer cursor position
psql $DATABASE_URL -c "SELECT contract_id, last_ledger_seq, updated_at FROM indexer_cursors ORDER BY updated_at DESC;"

# Check current Stellar network ledger
curl $SOROBAN_RPC_URL -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger","params":{}}'
```

**2. Stop the indexer**
```bash
# Kubernetes
kubectl scale deployment niffyinsure-indexer --replicas=0 -n production

# Docker Compose
docker compose stop indexer
```

**3. Reset the cursor to the desired start ledger**
```bash
# Replace <CONTRACT_ID> and <START_LEDGER> with actual values
psql $DATABASE_URL -c "
  UPDATE indexer_cursors
  SET last_ledger_seq = <START_LEDGER>, updated_at = NOW()
  WHERE contract_id = '<CONTRACT_ID>';
"
```

> **Warning:** Setting `START_LEDGER` too far back will cause the indexer to replay
> already-processed events. The indexer uses upsert semantics for `raw_events`, so
> duplicate ledger processing is safe but will increase DB load and catch-up time.

**4. (Optional) Purge stale derived data for the replay range**
```bash
# Only needed if derived tables (e.g. claims, policies) may have corrupt rows
# from the affected ledger range. Confirm with engineering before running.
psql $DATABASE_URL -c "
  DELETE FROM raw_events
  WHERE ledger_seq >= <START_LEDGER> AND ledger_seq <= <END_LEDGER>;
"
```

**5. Restart the indexer**
```bash
# Kubernetes
kubectl scale deployment niffyinsure-indexer --replicas=1 -n production

# Docker Compose
docker compose start indexer
```

**6. Monitor catch-up progress**
```bash
# Watch the cursor advance
watch -n 5 'psql $DATABASE_URL -c "SELECT last_ledger_seq, updated_at FROM indexer_cursors;"'

# Check Prometheus metric
curl http://localhost:3000/metrics | grep indexer_lag_ledgers
```

Alert threshold: `indexer_lag_ledgers > 500` → investigate RPC latency or increase `INDEXER_BATCH_SIZE` (see `backend/docs/indexer-runbook.md`).

**7. Verify data integrity post-reindex**
```bash
# Confirm event counts are consistent
psql $DATABASE_URL -c "SELECT COUNT(*) FROM raw_events WHERE ledger_seq >= <START_LEDGER>;"

# Spot-check a known claim or policy from the replayed range
psql $DATABASE_URL -c "SELECT id, status, updated_at FROM claims WHERE id = '<KNOWN_CLAIM_ID>';"
```

**8. Sign off**
- [ ] Cursor is at or near current network ledger
- [ ] No `indexer_lag_ledgers` alert firing
- [ ] Spot-check of replayed data passes
- [ ] Engineer sign-off: _name, date_

---

## 8. Contract Upgrade Procedure

Use this procedure to deploy a new WASM build to the Soroban contract and update all downstream references.

### Prerequisites
- Rust toolchain with `wasm32-unknown-unknown` target installed
- Stellar CLI (`stellar`) configured with the admin/upgrade keypair
- Access to the secrets manager to update `NIFFYINSURE_EXPECTED_WASM_HASH`
- DAO approval or governance vote reference (required for Mainnet upgrades)

### Step-by-step

**1. Build and verify the WASM**
```bash
# Build optimised release WASM
cargo build --release --target wasm32-unknown-unknown

# Compute the hash
sha256sum target/wasm32-unknown-unknown/release/niffyinsure.wasm
# Record this value as NEW_WASM_HASH
```

**2. Verify WASM drift baseline (pre-upgrade)**
```bash
# Confirm current on-chain hash matches the expected hash before proceeding
curl -X POST https://api.example.com/admin/maintenance/check-wasm-drift \
  -H "Authorization: Bearer $ADMIN_JWT"
# Expected: no drift alert. If drift is already present, investigate before upgrading.
```

**3. Upload the new WASM to the network**
```bash
stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/niffyinsure.wasm \
  --source <UPGRADE_KEYPAIR_ALIAS> \
  --network mainnet
# Note the returned WASM hash — must match NEW_WASM_HASH from step 1.
```

**4. Execute the upgrade**
```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source <UPGRADE_KEYPAIR_ALIAS> \
  --network mainnet \
  -- upgrade \
  --new_wasm_hash <NEW_WASM_HASH>
```

**5. Update the expected hash in secrets manager**
```bash
# AWS Secrets Manager example
aws secretsmanager update-secret \
  --secret-id NIFFYINSURE_EXPECTED_WASM_HASH \
  --secret-string "<NEW_WASM_HASH>"
```

**6. Update the deployment registry**
```json
// contracts/deployment-registry.json
{
  "contractName": "niffyinsure",
  "contractId": "<CONTRACT_ID>",
  "expectedWasmHash": "<NEW_WASM_HASH>",
  "deployedAt": "<ISO_TIMESTAMP>"
}
```

**7. Verify WASM drift post-upgrade**
```bash
# Trigger a drift check — should return clean (no mismatch)
curl -X POST https://api.example.com/admin/maintenance/check-wasm-drift \
  -H "Authorization: Bearer $ADMIN_JWT"

# Confirm no open drift alerts
psql $DATABASE_URL -c "SELECT * FROM wasm_drift_alerts WHERE resolved_at IS NULL;"
```

**8. Resolve any pre-existing drift alerts**
```sql
UPDATE wasm_drift_alerts
SET resolved_at = NOW()
WHERE contract_name = 'niffyinsure' AND resolved_at IS NULL;
```

**9. Rollback procedure**
If the upgrade introduces a regression:
1. Re-upload the previous WASM build (keep the artifact from the prior release).
2. Call `upgrade` with the old `WASM_HASH`.
3. Revert `NIFFYINSURE_EXPECTED_WASM_HASH` in secrets manager to the old hash.
4. Revert `contracts/deployment-registry.json`.
5. Re-run drift check to confirm clean state.
6. Document the rollback in the audit log with reason and DAO notification reference.

**Sign-off checklist:**
- [ ] New WASM hash verified against local build artifact
- [ ] Drift check clean post-upgrade
- [ ] `deployment-registry.json` updated and merged
- [ ] Secrets manager updated
- [ ] DAO / governance approval reference recorded
- [ ] Engineer sign-off: _name, date_

---

## 9. Emergency Pause Procedure

Use this procedure to halt claim processing or policy operations during a critical incident (e.g., smart contract exploit, oracle manipulation, regulatory hold).

### Pause scope

| Pause flag | Effect | Entrypoint |
|---|---|---|
| `claims_paused` | Blocks new claim filings and `finalize_claim`; `process_deadline` returns `CalculatorPaused` instead of panicking | `admin_set_claims_paused(true)` |
| `policy_paused` | Blocks new policy purchases | `admin_set_policy_paused(true)` |

### Prerequisites
- Admin keypair with `ADMIN` role on the contract
- Incident channel open (Slack `#incidents` or equivalent)
- At least one other engineer notified before executing on Mainnet

### Step-by-step

**1. Assess and declare incident**
- Open an incident in the incident tracker (PagerDuty / Linear).
- Post in `#incidents`: contract address, observed anomaly, proposed pause scope.
- Get verbal/async acknowledgement from one other engineer.

**2. Pause claims (if claim processing is affected)**
```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source <ADMIN_KEYPAIR_ALIAS> \
  --network mainnet \
  -- admin_set_claims_paused \
  --paused true
```

**3. Pause policy purchases (if policy issuance is affected)**
```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source <ADMIN_KEYPAIR_ALIAS> \
  --network mainnet \
  -- admin_set_policy_paused \
  --paused true
```

**4. Verify pause is active**
```bash
# Attempt a test claim filing — should return CalculatorPaused / PolicyPaused
stellar contract invoke \
  --id $CONTRACT_ID \
  --source <TEST_KEYPAIR_ALIAS> \
  --network mainnet \
  -- file_claim \
  --policy_id <TEST_POLICY_ID> \
  --description "pause verification test"
# Expected: transaction fails with CalculatorPaused or equivalent error
```

**5. Monitor and communicate**
- Post pause confirmation in `#incidents` with transaction hash.
- Notify DAO / community via governance forum if pause is expected to last > 1 hour.
- Update the incident tracker with pause timestamp and scope.

**6. Investigate root cause**
- Pull relevant logs: `grep '"level":"error"' /var/log/app/app.log | tail -200`
- Check Stellar explorer for anomalous transactions in the affected ledger range.
- Review `wasm_drift_alerts` for unexpected contract changes.

**7. Resume operations (rollback steps)**

Once the incident is resolved and root cause is confirmed safe:

```bash
# Resume claims
stellar contract invoke \
  --id $CONTRACT_ID \
  --source <ADMIN_KEYPAIR_ALIAS> \
  --network mainnet \
  -- admin_set_claims_paused \
  --paused false

# Resume policy purchases
stellar contract invoke \
  --id $CONTRACT_ID \
  --source <ADMIN_KEYPAIR_ALIAS> \
  --network mainnet \
  -- admin_set_policy_paused \
  --paused false
```

**8. Post-incident**
- Verify normal operations: submit a test claim in staging, confirm it processes.
- Resolve the incident in PagerDuty / Linear.
- Write a post-mortem within 5 business days covering: timeline, root cause, impact, and mitigations.
- Document the pause/resume in the audit log with incident reference.

**Sign-off checklist:**
- [ ] Pause confirmed active on-chain
- [ ] Incident declared and team notified
- [ ] Root cause identified before resuming
- [ ] Resume confirmed active on-chain
- [ ] Post-mortem scheduled or completed
- [ ] Engineer sign-off: _name, date_

---

## N. Admin Policy Termination with Open Claims (`allow_open_claims = true`)

### Overview

The `admin_terminate_policy` entrypoint accepts an `allow_open_claims` flag that,
when set to `true`, terminates a policy even if a claim is currently in `Processing`.
This is a **privileged governance action** with documented risks.

### When to use

Only use `allow_open_claims = true` when:

1. The policy must be terminated immediately (e.g., confirmed fraud, regulatory action).
2. The DAO has been notified and accepts that the in-flight claim will resolve independently.
3. Legal has confirmed the termination does not violate the holder's claim rights.

### What happens on-chain

- The policy is set `is_active = false` immediately.
- The `PolicyTerminated` event is emitted with `open_claim_bypass = 1` and `open_claims > 0`
  as the on-chain warning signal for indexers and operators.
- The in-flight claim vote **can still complete** after termination:
  - If **approved**: `process_claim` can still execute the payout (payout guard checks
    claim status, not policy status).
  - If **rejected**: `on_reject` fires `ClaimRejected` and `StrikeIncremented` for
    auditability, but **skips** `PolicyDeactivated` (policy already inactive).
- Strike count is incremented on rejection even though the policy is inactive.
- The `termination_reason` set at termination time is preserved; it is never overwritten
  by `ExcessiveRejections` from a subsequent rejection.

### Risks

| Risk | Mitigation |
|---|---|
| Holder loses claim rights if vote is manipulated post-termination | DAO snapshot is frozen at `file_claim`; admin cannot alter voter eligibility |
| Double-deactivation event spam | `on_reject` checks `policy.is_active` before emitting `PolicyDeactivated` |
| Approved claim payout blocked | `process_claim` is gated on claim status only; payout proceeds normally |
| Operator error (wrong policy) | Require two-step confirmation (propose + confirm) via `propose_admin_action` |

### Recommended procedure

1. Confirm the policy ID and holder address on a second channel.
2. Notify the DAO via governance forum before executing.
3. Call `admin_terminate_policy` with `allow_open_claims = true` from a multisig account.
4. Monitor the `PolicyTerminated` event in the indexer for `open_claim_bypass = 1`.
5. Track the in-flight claim to resolution; ensure payout or rejection is processed.
6. Document the action in the audit log with reason code and DAO approval reference.
