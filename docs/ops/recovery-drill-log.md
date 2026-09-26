# Recovery Drill Log

Track quarterly restore drills here after filing the full ticket from [`recovery-drill-ticket-template.md`](./recovery-drill-ticket-template.md).

| Date | Environment | Backup object | Replay ledger | Outcome | Evidence | Notes |
|---|---|---|---|---|---|---|
| 2026-03-29 | local repo | _N/A_ | _N/A_ | Implementation prepared | PR / local workspace | Backup, restore, and replay automation added; live restore not executed in this sandbox because `pg_dump`, `pg_restore`, `psql`, and Docker were unavailable |
| _Pending first quarterly drill_ | staging | _TBD_ | _TBD_ | _TBD_ | GitHub Actions artifact + auto-filed issue | Primary owner records observed RTO/RPO here after reviewing the workflow artifact |
| 2026-07-24 | local repo | _N/A_ | _N/A_ | Implementation prepared | `restore-evidence.json.measuredRtoMinutes` | `scripts/ops/postgres-restore-drill.sh` now times the restore (backup selection through post-restore validation) and emits `measuredRtoSeconds`/`measuredRtoMinutes` plus `rtoStatus` (`within_target`/`exceeds_target`) against the runbook's <= 2 hour (120 min) target. Live timed restore against a production-sized dump not executed in this sandbox (`pg_restore`/`psql`/AWS creds unavailable); primary owner should run the workflow against a real production-sized backup and record the actual measured minutes here, replacing this row. |
