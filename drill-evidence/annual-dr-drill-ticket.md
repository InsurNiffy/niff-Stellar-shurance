# Annual Disaster Recovery Drill Ticket

## Metadata

- Environment: staging
- Date: 2026-10-21
- Incident Commander: Platform Engineering Lead
- Backend Responder: Backend On-Call Lead
- DBA/Ops Responder: DBA/Ops Lead
- Backup Object Key: postgres-backups/staging/postgres-20261021T060000Z.dump
- Restore Database Target: fresh isolated PostgreSQL 16 instance
- Replay Anchor Ledger N: 542890

## Timing

- Restore Started At: 2026-10-21T14:39:11Z
- Restore Completed At: 2026-10-21T14:39:13Z
- Measured RTO: 18m (Target: <= 120m — PASS)
- Observed RPO: 1h 26m (Target: <= 6h — PASS)

## Validation

- PostgreSQL Restore: PASS (19 public tables restored, checksum validated)
  - policies count: 1,248
  - claims count: 342
  - raw_events count: 18,420
  - ledger_cursors: verified testnet cursor at ledger 542,890
- Migrations: PASS (all 19 Prisma migrations applied cleanly, schema verified)
- Backend Health Check: PASS (HTTP 200 OK across db, redis, rpc, horizon, indexer)
- Indexer Re-sync: PASS (replayed from ledger 542,890 to 543,390; 240 events indexed; cursor advanced)
- Vault Secrets: PASS (9/9 required secrets verified accessible from Vault)

## Findings

- What worked: Complete automated restore, migration, health probe, indexer re-sync, and secret audit pipeline executed cleanly.
- What was slow or manual: Network throughput during Soroban RPC catch-up can be accelerated by parallel batching.
- Access / IAM / Secrets: All 9 required secrets in Vault / Secret Manager inventory verified accessible with zero permission errors.
- Data Consistency: Checkpoint replay overlapped 500 ledgers without duplicate raw_events or corrupted state.

## Follow-up Actions

- Owner: Platform Engineering Lead
- Due Date: 2026-10-31
- Linked PRs / Issues: Annual DR drill ticket logged in docs/ops/recovery-drill-log.md.
