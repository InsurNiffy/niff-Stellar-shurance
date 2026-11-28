# Scheduled Maintenance Cleanup

`ScheduledCleanupService` (`src/maintenance/scheduled-cleanup.service.ts`) runs weekly
on **Sunday 03:00 UTC** (off-peak) via `@Cron('0 3 * * 0')`.

| Step | Target | Rule |
| --- | --- | --- |
| Purge deleted comments | `claim_comments` | `deleted_at IS NOT NULL` and older than 90 days → hard delete |
| Archive resolved claims | `claims` → `claim_archive` | finalized, status `PAID`/`REJECTED`/`APPEAL_APPROVED`/`APPEAL_REJECTED`, last updated > 2 years ago; full row stored in `snapshot` (JSONB), then removed (comments, votes and evidence cascade) |
| Purge expired flags | `feature_flags` | `expires_at < now()` → delete; flags without `expires_at` never expire |

Claims are archived in batches of 500, each batch in a single transaction.

## Soft Delete & Data Retention Lifecycle

`policies`, `claims`, and `votes` carry a nullable `deleted_at` timestamp. A non-null
`deleted_at` marks a row as soft-deleted: it is retained for audit purposes but hidden
from public API responses.

### Soft delete

- `DELETE /admin/policies/:id` sets `deleted_at = now()` instead of removing the row.
  The row (and its audit trail) is preserved.
- Public list/detail queries filter with `deleted_at IS NULL` so soft-deleted rows never
  appear in public API responses.
- Admin queries may opt in to soft-deleted rows with `include_deleted=true`; when the
  flag is absent or `false`, the `deleted_at IS NULL` filter still applies.

### Retention cleanup

`DataRetentionService` permanently removes rows whose `deleted_at` is older than
`DATA_RETENTION_DAYS` (read from the environment). Only rows beyond the retention
window are hard-deleted; rows still inside the window are left untouched. The service
is invoked by the scheduled cleanup job and can also be run on demand.
