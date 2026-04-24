# Queue Replay Runbook

## Overview

This runbook covers manual inspection and replay of failed BullMQ jobs that have
exhausted their retry budget and landed in the dead-letter (failed) set.

Queues monitored:

| Queue name       | Purpose                                      | Max retries |
|------------------|----------------------------------------------|-------------|
| `indexer`        | Soroban event indexing → DB writes           | 5           |
| `notifications`  | Claim-finalized and renewal-reminder alerts  | 5           |
| `claim-events`   | Claim event fan-out                          | 5           |
| `reindex`        | Admin-triggered ledger reindex               | 5           |

---

## Prometheus Alert

The `DlqDepthHigh` alert fires when any queue's failed-job count exceeds **10**
for 5 consecutive minutes:

```yaml
# backend/docs/prometheus-alerts.yml
- alert: DlqDepthHigh
  expr: bullmq_dlq_depth{app="niffyinsure-api"} > 10
  for: 5m
  labels:
    severity: critical
```

When this alert fires, follow the triage steps below.

---

## Triage

### 1. Identify the affected queue

Check the `queue` label on the alert or query Prometheus directly:

```promql
bullmq_dlq_depth{app="niffyinsure-api"}
```

For job-level detail (job name + failure reason):

```promql
increase(bullmq_dlq_jobs_total{app="niffyinsure-api"}[1h])
```

### 2. Inspect failed jobs via Bull Board

Bull Board is available at `/admin/queues` (requires admin JWT):

1. Open `https://<host>/admin/queues` in a browser.
2. Select the affected queue from the left sidebar.
3. Click the **Failed** tab to see job IDs, payloads, and error messages.
4. Review the stack trace on individual jobs to determine root cause.

### 3. Determine replay eligibility

| Failure reason                        | Action                                      |
|---------------------------------------|---------------------------------------------|
| Transient (Redis timeout, SMTP down)  | Safe to replay after the dependency recovers |
| Bad payload / validation error        | Fix the producer before replaying           |
| Contract state mismatch               | Investigate on-chain state first            |
| Unknown / unexpected                  | Escalate to on-call engineer                |

---

## Replay Procedure

### Option A — API (recommended for single jobs)

```bash
curl -X POST https://<host>/api/admin/queues/<queue>/jobs/<jobId>/retry \
  -H "Authorization: Bearer <admin-jwt>"
```

Example:

```bash
curl -X POST https://api.niffyinsure.io/api/admin/queues/notifications/jobs/42/retry \
  -H "Authorization: Bearer $ADMIN_JWT"
```

The endpoint:
1. Calls `job.retry('failed')` via `QueueMonitorService.replayJob`.
2. Writes an immutable audit row (`action: dlq_job_replayed`) with actor and job details.
3. Returns `{ queue, jobId, status: "retried" }`.

### Option B — Bull Board UI

1. Navigate to `/admin/queues/<queue>` → **Failed** tab.
2. Click **Retry** on the individual job, or **Retry all** to replay the entire failed set.

> **Warning:** "Retry all" replays every failed job at once. Use only when the
> root cause is confirmed to be transient and all jobs are safe to re-process.

### Option C — Redis CLI (break-glass only)

Use only when the API and Bull Board are unavailable:

```bash
# List failed job IDs
redis-cli LRANGE bull:<queue>:failed 0 -1

# Move a specific job back to waiting
redis-cli LMOVE bull:<queue>:failed bull:<queue>:wait RIGHT LEFT
```

Replace `<queue>` with the queue name (e.g. `notifications`).

---

## Post-Replay Verification

1. Monitor `bullmq_dlq_depth{queue="<queue>"}` — it should decrease.
2. Confirm the replayed jobs complete successfully (check Bull Board **Completed** tab).
3. Verify downstream effects (e.g. notification delivered, DB row updated).
4. If jobs fail again immediately, the root cause is not resolved — do not replay further.

---

## Retention Policy

Failed jobs are retained in Redis for up to **500 entries** per queue
(`removeOnFail: { count: 500 }`). Older entries are evicted automatically.
There is no separate persistent DLQ store; if a job is evicted before replay,
it must be reconstructed from the `admin_audit_logs` table or application logs.

---

## Escalation

| Condition                                      | Escalate to          |
|------------------------------------------------|----------------------|
| DLQ depth > 100 on `indexer`                  | On-call backend eng  |
| Replay fails repeatedly with same error        | On-call backend eng  |
| Suspected data corruption in DB               | Data team + CTO      |
| Notification queue depth > 50 for > 30 min    | On-call backend eng  |
