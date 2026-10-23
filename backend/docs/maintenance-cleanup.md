# Scheduled Maintenance Cleanup

`ScheduledCleanupService` (`src/maintenance/scheduled-cleanup.service.ts`) runs weekly
on **Sunday 03:00 UTC** (off-peak) via `@Cron('0 3 * * 0')`.

| Step | Target | Rule |
| --- | --- | --- |
| Purge deleted comments | `claim_comments` | `deleted_at IS NOT NULL` and older than 90 days → hard delete |
| Archive resolved claims | `claims` → `claim_archive` | finalized, status `PAID`/`REJECTED`/`APPEAL_APPROVED`/`APPEAL_REJECTED`, last updated > 2 years ago; full row stored in `snapshot` (JSONB), then removed (comments, votes and evidence cascade) |
| Purge expired flags | `feature_flags` | `expires_at < now()` → delete; flags without `expires_at` never expire |

Claims are archived in batches of 500, each batch in a single transaction.
