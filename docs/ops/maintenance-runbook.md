# Operational Maintenance Runbook

**Owner:** Engineering + Legal + Ops  
**Review cadence:** Quarterly (align with backup drill — see backup issue)  
**Last signed off:** _YYYY-MM-DD — replace before first production use_

---

## 1. Wasm Drift Detection

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

Cross-link: see backup issue for full restore procedure.

Ops calendar entry: **first Monday of each quarter**.

Checklist:
- [ ] Restore latest DB backup to staging
- [ ] Verify `wasm_drift_alerts` and `privacy_requests` tables present and populated
- [ ] Re-run wasm drift check against staging contract
- [ ] Confirm audit log is append-only (attempt UPDATE/DELETE → expect permission denied)
- [ ] Record drill completion in ops calendar with timestamp and engineer sign-off

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
- **Policies:** For each tracked `(holder, policy_id)` (from indexer), call `process_expired` once `current_ledger >= end_ledger + grace`. Daily or weekly scans are enough if the indexer backfills; tighter cadence improves UI accuracy for “lapsed” state.

### Incentives
There is **no protocol reward** for keepers; operators run them to support product liveness (deadlines, lapsed flags) and their own UX. Use a dedicated funded account only for network fees.

### Failure modes
- `process_expired`: reverts with `PolicyLapseNotReached` until grace end; `OpenClaimsMustFinalize` if a claim is still open on that policy.
- `process_deadline`: reverts with `VotingWindowStillOpen` until after the voting deadline ledger; `ClaimAlreadyTerminal` if already finalized; `ClaimNotProcessing` if the claim left `Processing` without being terminal (e.g. appeal flows); `CalculatorPaused` while claims are paused (unlike `finalize_claim`, which panics on pause).

