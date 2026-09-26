# Appeal Finalize Keeper Job

## Overview

Scheduled keeper job (`AppealFinalizeKeeperService`) that automatically finalizes expired claim appeals by calling the permissionless `finalize_appeal` contract function.

When a claimant files an appeal, their claim moves to `UNDER_APPEAL` status and the contract sets an `appeal_open_deadline_ledger`. Once the deadline passes, the appeal window closes and `finalize_appeal` must be called to resolve the appeal on-chain. This keeper scans for expired appeals and calls `finalize_appeal` reliably, with automatic retry on transient failures and alerting on persistent ones.

**Goal:** Eliminate manual/ad hoc `finalize_appeal` calls and ensure expired appeals are processed automatically.

## Schedule

| Setting | Value | Rationale |
|---------|-------|-----------|
| **Cron expression** | `0 */15 * * * *` (every 15 minutes) | Proposed default; balances RPC load vs. finalization latency. Review and adjust per operational needs. |
| **Timezone** | UTC (Stellar network time) | Ledger sequence is chain-global. |
| **Concurrent runs** | Single (no overlap) | NestJS `@Cron` serializes by default. |

### Changing the schedule

Edit the `@Cron` decorator in `backend/src/jobs/appeal-finalize-keeper.service.ts`:

```typescript
@Cron('0 */10 * * * *')  // Change to every 10 minutes
async runFinalizationCycle(): Promise<void> { ... }
```

Redeploy backend service. No DB migration needed.

## Configuration

### Required environment variables

| Variable | Description | Example |
|----------|-------------|---------|
| `CLAIM_KEEPER_SOURCE_ACCOUNT` | Stellar account used as RPC simulation source (permissionless keeper) | `GAAAA...` |
| `CLAIM_KEEPER_SECRET_KEY` | Private key of keeper account (for signing `finalize_appeal` txs) | (stored in secrets manager) |

Both are already required for the manual admin `/api/admin/claims/:id/finalize-appeal` endpoint. Keeper reuses the same account.

### Optional environment variables

None. Retry and alerting parameters are hardcoded (see "Tuning" below).

## How it works

1. **Every 15 minutes (default):**
   - Query all DB claims with `status = UNDER_APPEAL`.
   - Fetch on-chain claim data via `simulateGetClaimsBatch` (includes `appeal_open_deadline_ledger`).
   - Get current ledger sequence.

2. **For each expired claim** (deadline ≤ current ledger):
   - Call `finalize_appeal(claimId)` with up to 3 retries on transient failures.
   - Log success / failure.
   - **Idempotent:** If claim is already finalized or not in `UNDER_APPEAL` state, skip (no error).

3. **On transient failure** (network timeout, RPC unavailable):
   - Retry with exponential backoff: 1s, 2s, 4s.
   - Log each retry.

4. **On persistent failure** (all retries exhausted):
   - Log error at job level.
   - **Track failure count per claim per cycle.**
   - If a claim fails in 3+ consecutive cycles: emit `ALERT` log.

5. **End of cycle:**
   - Log summary (# finalized, # skipped, # failures).

## Tuning parameters (proposed defaults)

All are hardcoded in `AppealFinalizeKeeperService`:

| Parameter | Value | Purpose | Override method |
|-----------|-------|---------|-----------------|
| `maxRetries` | 3 | Transient error retry limit | Edit service constant |
| `retryBaseDelayMs` | 1000 | Exponential backoff base (1s) | Edit service constant |
| `persistentFailureThreshold` | 3 | Consecutive failure cycles to trigger alert | Edit service constant |

### Recommended adjustments

- **High RPC load:** Increase cron interval to `0 */30 * * * *` (every 30 min).
- **Slow RPC:** Increase `retryBaseDelayMs` to `2000` (2s base).
- **Stricter alerting:** Reduce `persistentFailureThreshold` to `2`.
- **Lenient retry:** Increase `maxRetries` to `5`.

Redeploy backend after any constant change.

## Failure modes and recovery

### 1. Missing configuration

**Symptom:** Log warns `CLAIM_KEEPER_SOURCE_ACCOUNT not configured`.

**Recovery:**
1. Ensure `CLAIM_KEEPER_SOURCE_ACCOUNT` and `CLAIM_KEEPER_SECRET_KEY` are set in env.
2. Verify they match the deployed keeper keypair.
3. Restart backend service.

### 2. RPC unavailable

**Symptom:** Logs show repeated `RPC unavailable`, `Network timeout`, or `simulateGetClaimsBatch` errors.

**Recovery:**
1. Check RPC endpoint health (e.g., Soroban testnet status page).
2. If RPC is down, the keeper retries automatically (no manual action needed).
3. Once RPC recovers, the next cycle will finalize any missed claims.
4. **Note:** The keeper is idempotent; repeated `finalize_appeal` calls on the same claim are safe.

### 3. Persistent finalization failures (alert emitted)

**Symptom:** Log contains `ALERT: Claim X has persistent failure`.

**Possible causes:**
- Claim is genuinely invalid or corrupted on-chain.
- Contract state mismatch (e.g., already finalized manually, but DB is stale).
- Bug in keeper logic.

**Investigation steps:**
1. Look up the claim ID in logs: `ALERT: Claim <ID>`.
2. Query contract directly: `soroban contract invoke ... --id <ID> get_claim`.
3. Check its `status` and `appeal_open_deadline_ledger`.
4. If already approved/rejected, update DB status to match (manual reconciliation).
5. If still in `UNDER_APPEAL` with deadline passed, try manual finalization:
   ```bash
   curl -X POST https://api.example.com/api/admin/claims/<ID>/finalize-appeal \
     -H "Authorization: Bearer $ADMIN_JWT"
   ```
6. If manual finalization also fails, check contract logs and escalate to security team.

### 4. Claim not found on-chain

**Symptom:** Log debug: `Claim X not found on-chain — skipping`.

**Possible causes:**
- Claim ID is incorrect (indexer bug).
- Claim was deleted on-chain (unlikely).
- RPC query returned incomplete result.

**Recovery:**
- Keeper skips the claim gracefully; finalization is retried next cycle.
- If persistent, investigate indexer sync status and contract state.

## Monitoring & alerting

### Log patterns to monitor

| Log level | Pattern | Action |
|-----------|---------|--------|
| `ERROR` | `Appeal finalization cycle failed:` | Backend may be down or misconfigured. Check health. |
| `WARN` | `Claim X finalization attempt Y failed: ...` | Transient RPC issue. Monitor; auto-retry in progress. |
| `WARN` | `ALERT: Claim X has persistent failure` | Investigate & resolve (see failure mode #3 above). |
| `LOG` | `Found N expired appeal(s)` | Normal operation. |

### Metrics to expose (future enhancement)

Proposed (not yet implemented):
- `appeal_finalization_cycles_total` — cumulative cycle runs.
- `appeal_finalization_success_total` — successfully finalized claims.
- `appeal_finalization_failure_total` — persistent failures.
- `appeal_finalization_retry_total` — transient retries.

### Alerting integration

**Current:** Logs only (via NestJS Logger).

**Recommended future setup:**
- Forward logs to centralized aggregator (e.g., ELK, Grafana Loki).
- Alert on `ALERT:` pattern → PagerDuty/Slack.
- Example: "Appeal keeper: persistent failure on claim X — manual intervention required."

## Testing

### Unit tests

Located in `backend/src/jobs/appeal-finalize-keeper.service.spec.ts`:

- ✅ Identifies expired vs non-expired claims.
- ✅ Calls `finalize_appeal` only for expired.
- ✅ Retries on transient failures with exponential backoff.
- ✅ Alerts on persistent failures (threshold reached).
- ✅ Gracefully skips already-finalized claims.
- ✅ Idempotent across multiple cycles.

Run: `npm test -- appeal-finalize-keeper.service.spec.ts`

### Manual e2e test (staging only)

1. Create a test claim on staging contract and advance it to `UNDER_APPEAL`.
2. Set its `appeal_open_deadline_ledger` to a past ledger (e.g., `current - 100`).
3. Wait for next keeper cycle (or trigger manually via debug endpoint).
4. Verify:
   - Logs show claim identified as expired.
   - `finalize_appeal` called on-chain.
   - Claim status updated to `APPROVED` or `REJECTED` (depending on appeal outcome).

**Note:** Do NOT run keeper against production until tested thoroughly in staging.

## Rollout plan

1. **Staging:** Deploy and run for 1 week. Monitor logs for false positives / misidentifications.
2. **Canary (prod):** Deploy to 1 region; monitor for 3 days.
3. **Full prod:** Rollout to all regions. Alerting active.
4. **Ops review:** Weekly check of persistent failure counts and retry stats (future).

## Related documentation

- [Appeal flow architecture](../appeal/appeal-flow.md) — claim states and appeal lifecycle.
- [Soroban contract integration](../soroban/contract-interaction.md) — `finalize_appeal` function spec.
- [Admin safety valve runbook](./admin-force-finalize-appeal.md) — manual override steps (if created).
- Issue #1351 — Original request for keeper automation.

## Version history

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2026-08-28 | 1.0 | Initial implementation with 15-min schedule, 3-retry backoff, 3-cycle alert threshold | aji70 |

---

**Last reviewed:** 2026-08-28
**Next review due:** 2026-09-28 (30 days)
**Owner:** Ops / Backend team

