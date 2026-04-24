# Disaster Recovery Runbook

**Owner:** Platform Engineering  
**Primary responders:** Backend on-call, DBA/Ops, Incident Commander  
**Review cadence:** Quarterly, immediately after every restore drill  
**Evidence:** Quarterly drill artifact from `.github/workflows/recovery-drill.yml` plus a ticket created from [`recovery-drill-ticket-template.md`](./recovery-drill-ticket-template.md)

## Recovery objectives

| Asset / scenario | Authoritative source | Target RPO | Target RTO | Notes |
|---|---|---|---|---|
| PostgreSQL primary (`policies`, `claims`, `votes`, `raw_events`, `ledger_cursors`, admin audit) | Encrypted S3 `pg_dump` backups + Stellar chain replay | <= 6 hours | <= 2 hours to restore latest dump to a fresh instance | Backups run every 6 hours via `.github/workflows/postgres-backup.yml` |
| Chain-derived state after DB loss | Stellar/Soroban ledger events for `CONTRACT_ID` | 0 once replay completes | <= 4 hours from restore start, depending on replay depth and RPC health | Replay from ledger `N` overlaps the restored cursor to recover in-flight queue loss |
| Redis cache / nonce / rate-limit keys | Recreated by application traffic | Accepted loss: full loss | <= 15 minutes | Redis is not backed up for these classes; Postgres remains authoritative |
| Redis-backed BullMQ queue state (`claim-events`, `reindex`) | Redis plus chain replay/manual re-enqueue | Accepted loss: queue contents may be lost; derived DB state recovered by replay from ledger `N` | <= 30 minutes to re-establish queue service; <= 4 hours to fully replay derived state | See accepted loss windows below |

## Accepted gaps and mitigations

- PostgreSQL backups are logical `pg_dump` snapshots, not point-in-time recovery. The current gap between two successful backups can be up to 6 hours.
- Redis is treated as an operational layer, not a system of record. We accept full loss of cache, nonce, and rate-limit keys.
- `claim-events` BullMQ jobs can be lost if Redis is lost between enqueue and processing. Mitigation: restore Postgres, then replay from ledger `N = max(contract deployment ledger, restored last_processed_ledger - 500)` to overlap any in-flight queue work.
- Notification delivery is not yet durably queued. [`backend/src/notifications/notifications.consumer.ts`](../../backend/src/notifications/notifications.consumer.ts) currently uses an in-process event bus, and [`backend/src/webhooks/queue.ts`](../../backend/src/webhooks/queue.ts) is an in-memory queue. Accepted loss window for those paths is "since last process restart." Mitigation: manual resend from the restored claims/audit state, plus a future migration to BullMQ/SQS.

## Automated controls

### Backup job

- Workflow: [`.github/workflows/postgres-backup.yml`](../../.github/workflows/postgres-backup.yml)
- Schedule: every 6 hours at `15 */6 * * *`
- Method: `pg_dump --format=custom --compress=9`
- Encryption at rest: S3 `SSE-KMS` using `BACKUP_KMS_KEY_ID`
- Retention: repo variable `BACKUP_RETENTION_DAYS` plus per-run pruning
- Storage location: `s3://$BACKUP_BUCKET/$BACKUP_PREFIX/$BACKUP_ENVIRONMENT/postgres-<timestamp>.dump` with adjacent `.metadata.json`
- Evidence: uploaded metadata artifact and S3-side metadata JSON
- Restore verification: every successful backup is restored into an ephemeral PostgreSQL service and checked against metadata row counts
- Failure alert: optional `OPS_ALERT_WEBHOOK_URL` webhook

### Quarterly restore drill

- Workflow: [`.github/workflows/recovery-drill.yml`](../../.github/workflows/recovery-drill.yml)
- Schedule: first Monday of January, April, July, and October
- Restores the latest dump into a fresh Postgres service
- Verifies required tables and captures row-count evidence
- Replays the indexer from `DRILL_REINDEX_FROM_LEDGER` using [`backend/scripts/replay-indexer.ts`](../../backend/scripts/replay-indexer.ts)
- Uploads evidence artifacts for 365 days
- Files a GitHub issue from the drill ticket template on scheduled runs and on manual runs unless `create_ticket` is disabled

### Quarterly owner rotation

| Quarter | Primary owner | Secondary owner | Required filing |
|---|---|---|---|
| Q1 | Backend on-call lead | DBA/Ops lead | GitHub issue from workflow + drill log row |
| Q2 | DBA/Ops lead | Backend on-call lead | GitHub issue from workflow + drill log row |
| Q3 | Platform Engineering lead | Incident Commander delegate | GitHub issue from workflow + drill log row |
| Q4 | Incident Commander delegate | Platform Engineering lead | GitHub issue from workflow + drill log row |

The primary owner reviews the uploaded artifact, records observed RTO/RPO in [`recovery-drill-log.md`](./recovery-drill-log.md), and opens follow-up issues for any access, restore, replay, or smoke-test gaps within 48 hours.

## IAM and access-path requirements

Use separate OIDC-assumable IAM roles for backup and restore drill workflows.

### Backup role

- Allow `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:AbortMultipartUpload` on `arn:aws:s3:::<bucket>/<prefix>/<environment>/*`
- Allow `s3:ListBucket` on `arn:aws:s3:::<bucket>` with a condition restricting `s3:prefix` to `<prefix>/<environment>/`
- Allow `kms:Encrypt`, `kms:Decrypt`, `kms:GenerateDataKey`, `kms:DescribeKey` only for the backup KMS key
- Deny non-TLS access and deny `s3:PutObject` unless `s3:x-amz-server-side-encryption = aws:kms`

### Restore-drill role

- Allow `s3:GetObject` and `s3:ListBucket` on the same scoped prefix
- Allow `kms:Decrypt` and `kms:DescribeKey` only for the backup KMS key
- Do not grant `s3:DeleteObject` to the restore role

### Path restrictions

- Bucket policy must only permit writes from the backup role and reads from the restore role
- No public bucket ACLs or public bucket policies
- GitHub Actions uses OIDC via `aws-actions/configure-aws-credentials`; do not store long-lived AWS access keys in repo secrets

## Partial vs total loss response matrix

| Scenario | What to restore | Service posture | Next action |
|---|---|---|---|
| Redis only lost | Nothing from backup | API can run degraded; caches repopulate; nonces/rate limits reset | Restart Redis, verify BullMQ connectivity, decide whether to replay chain-derived work from ledger `N` |
| PostgreSQL only lost | Restore latest backup to fresh Postgres | Put write paths in maintenance mode until restore completes | Restore DB, validate key tables, then replay from ledger `N` |
| PostgreSQL + Redis lost | Restore Postgres first, rebuild Redis by traffic and workers | Full maintenance mode during restore | Restore DB, bring up Redis, run indexer replay, then reopen traffic |
| Partial table corruption in Postgres | Fresh restore to alternate instance, compare counts, promote after validation | Prefer alternate instance over in-place surgery | Use latest backup, sanity-check `raw_events` and `ledger_cursors`, then cut over |

## Step-by-step restore procedure

### 1. Declare the incident

Owner: Incident Commander

1. Open the incident ticket from [`recovery-drill-ticket-template.md`](./recovery-drill-ticket-template.md).
2. Record the timestamp, affected environment, suspected blast radius, and current API posture.
3. Freeze schema migrations and non-essential deploys until recovery completes.

### 2. Contain writes

Owner: Backend on-call

1. Put public write flows into maintenance mode or scale the API to zero.
2. Confirm no Prisma migrations are running.
3. If Redis is healthy, pause BullMQ workers to avoid writes into a half-restored database.

### 3. Select the backup object

Owner: DBA/Ops

1. Prefer the latest successful object under `s3://<bucket>/<prefix>/<environment>/`.
2. If the most recent backup overlaps the incident window, step back to the previous healthy object.
3. Record the chosen object key and metadata JSON in the incident ticket.

### 4. Restore to a fresh PostgreSQL instance

Owner: DBA/Ops

Automated drill path:

```bash
gh workflow run recovery-drill.yml
```

Manual path:

```bash
aws s3 cp s3://$BACKUP_BUCKET/$BACKUP_OBJECT_KEY /tmp/recovery.dump
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --no-privileges /tmp/recovery.dump
```

### 5. Validate the restore

Owner: Backend on-call

Run at minimum:

```bash
psql "$RESTORE_DATABASE_URL" -Atqc "SELECT COUNT(*) FROM policies;"
psql "$RESTORE_DATABASE_URL" -Atqc "SELECT COUNT(*) FROM claims;"
psql "$RESTORE_DATABASE_URL" -Atqc "SELECT COUNT(*) FROM raw_events;"
psql "$RESTORE_DATABASE_URL" -Atqc "SELECT network, last_processed_ledger FROM ledger_cursors ORDER BY network;"
```

Expected outcome:

- `policies`, `claims`, `votes`, `raw_events`, `ledger_cursors`, and `admin_audit_logs` all exist
- counts are plausible for the chosen backup point
- the restored `ledger_cursors` row gives you the last durable processed ledger

### 6. Rebuild indexer state from chain

Owner: Backend on-call

Choose replay anchor ledger `N` like this:

1. Read the restored `ledger_cursors.last_processed_ledger`
2. Subtract a 500-ledger overlap buffer to recover any queue work that may have been in Redis but not fully materialized
3. Clamp to the deployment start ledger for the active contract version

Example:

```bash
export N=123456
cd backend
npm run ops:replay-indexer -- --from-ledger "$N" --network "$STELLAR_NETWORK" --output ../drill-evidence/indexer-replay.json
```

If you are replaying inside a deployed environment instead of locally, you may use the admin queue surface:

```bash
curl -X POST https://api.example.com/admin/reindex \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d "{\"fromLedger\": $N, \"network\": \"$STELLAR_NETWORK\"}"
```

Success criteria:

- replay reaches chain head without fatal errors
- `ledger_cursors.last_processed_ledger` advances to the current ledger window
- claim/policy materialized counts remain internally consistent after replay

### 7. Redis decision after restore

Owner: Backend on-call

| Redis data class | Backup required? | Accepted loss window | Recovery action |
|---|---|---|---|
| Response caches | No | Full loss accepted | Warm naturally from traffic |
| Wallet-auth nonces | No | Full loss accepted | Users request a fresh challenge |
| Rate-limit counters | No | Full loss accepted | Counters rebuild automatically |
| BullMQ `claim-events` | No separate Redis backup today | Up to time since last successful replay anchor | Rebuild from chain using step 6 |
| BullMQ `reindex` | No separate Redis backup today | Full loss accepted | Re-submit job manually |
| Notifications / webhook queue | Not durable today | Since last process restart | Manual resend from restored DB/audit state |

### 8. Cut over and close

Owner: Incident Commander

1. Repoint the application to the restored database.
2. Unpause workers after replay completes.
3. Remove maintenance mode and run a smoke test on claims, policy read paths, and `/health`.
4. Attach restore evidence, replay evidence, and timestamps to the incident ticket.
5. Record gaps and follow-up actions in [`recovery-drill-log.md`](./recovery-drill-log.md).

## Drill checklist

- [ ] Latest backup restored to a fresh Postgres instance
- [ ] Required tables verified
- [ ] Replay executed from ledger `N`
- [ ] Start/end timestamps captured
- [ ] Observed RPO and RTO recorded
- [ ] Gaps and mitigations recorded in ticket and drill log
