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

## Contract upgrade rollback (blue-green)

Contract upgrades are irreversible once applied on-chain. Treat every upgrade as a blue-green deployment: stage the new WASM on testnet, verify it, then apply to mainnet with a documented rollback path. The rollback path is always a hotfix WASM re-deploy of the last known-good version — there is no in-place revert.

### 1. Pre-upgrade snapshot

Owner: Backend on-call + DBA/Ops

1. Record the current on-chain contract version by calling `get_contract_version()` on the live `CONTRACT_ID` and paste the result into the upgrade ticket.
2. Snapshot the treasury balance (token contract `balance(treasury)` and native XLM balance) and attach the values to the ticket.
3. Export all open claim IDs (`SELECT id FROM claims WHERE status = 'open' ORDER BY id`) and attach the CSV to the ticket. This is the baseline used to verify no claims are lost or double-settled after the upgrade.
4. Archive the currently deployed WASM hash (`stellar contract info --id $CONTRACT_ID`) so the last known-good artifact can be re-deployed during rollback.
5. Freeze non-essential deploys and pause the indexer until the upgrade window closes.

### 2. During upgrade (testnet first, then mainnet)

Owner: Backend on-call

1. Deploy the candidate WASM to testnet: `stellar contract install --wasm <candidate.wasm> --network testnet`, then `stellar contract deploy`/`upgrade` against the testnet `CONTRACT_ID`.
2. Run the smoke tests against testnet: create a claim, vote, settle, and confirm `get_contract_version()` returns the expected new version.
3. Only after testnet smoke tests pass, apply the same WASM to mainnet via `stellar contract upgrade --id $CONTRACT_ID --wasm <candidate.wasm> --network mainnet`.
4. Record the mainnet transaction hash and the new WASM hash in the upgrade ticket.

### 3. Post-upgrade verification

Owner: Backend on-call

1. Call `get_contract_version()` on mainnet and confirm it returns the expected version string from the upgrade ticket.
2. Re-query the treasury balance and compare against the pre-upgrade snapshot; investigate any unexpected delta.
3. Re-query open claim IDs and diff against the pre-upgrade CSV; every previously open claim must still be present and settleable.
4. Run the mainnet smoke tests (create, vote, settle) and confirm the indexer resumes from the correct ledger cursor.
5. If any check fails, stop and execute the rollback procedure below.

### 4. Rollback: hotfix WASM re-deploy

Owner: Backend on-call + Incident Commander

1. Declare the incident and freeze further upgrades.
2. Re-install the last known-good WASM archived during the pre-upgrade snapshot: `stellar contract install --wasm <last-good.wasm> --network mainnet`.
3. Re-deploy the last known-good WASM to `CONTRACT_ID` via `stellar contract upgrade --id $CONTRACT_ID --wasm <last-good.wasm> --network mainnet`.
4. Verify `get_contract_version()` returns the previous (known-good) version.
5. Re-run the treasury balance and open claim ID checks against the pre-upgrade snapshot to confirm state integrity.
6. Resume the indexer from the pre-upgrade ledger cursor and reopen traffic.
7. File a post-incident review documenting the failed upgrade, the rollback transaction hash, and any state reconciliation performed.

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
aws s3 cp s3://$BACKUP_BUCKET/$BACK