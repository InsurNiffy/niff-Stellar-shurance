# Staging Data Refresh Job

## Overview

Periodic job that (re)populates the staging environment's database with
either anonymized-production data or synthetic data, per the
[environment data policy](./environment-data-policy.md).

## Data Source

Any run of this job must comply with the
[environment data policy](./environment-data-policy.md#data-source-by-environment):
staging may be refreshed with anonymized-production data or synthetic data,
never raw production data. If anonymized-production data is used, it must
meet all of the
[anonymization requirements](./environment-data-policy.md#anonymization-requirements)
before being loaded into staging.

## Schedule

Runs weekly via cron: **every Sunday at 02:00 UTC**.

```
0 2 * * 0  /scripts/ops/staging-data-refresh.sh
```

The job is a no-op unless the environment variable `STAGING_REFRESH_ENABLED=true`
is set in the staging environment. This gate prevents accidental runs in
production or in developer-local environments.

## Steps

### 1. Export recent claims and policies from production

Export the last 90 days of `claims` and `policies` rows from the production
PostgreSQL instance using `pg_dump` with `--table` filters:

```bash
pg_dump "$PROD_DATABASE_URL" \
  --table=claims \
  --table=policies \
  --data-only \
  --format=custom \
  --file=/tmp/prod-snapshot.dump
```

### 2. Anonymize all PII

Before the snapshot is loaded into staging, every PII field must be
transformed:

| Field | Transformation |
|---|---|
| `wallet_address` | SHA-256 hash (hex, first 40 chars) |
| `display_name` | Replace with a deterministic UUID derived from the original value |
| `email` | Replace with `<uuid>@anon.invalid` |
| `ip_address` | Nulled out |
| Any other PII fields | Nulled out or replaced with a UUID per column |

Anonymization is performed by the `scripts/ops/anonymize-snapshot.py` script,
which reads `/tmp/prod-snapshot.dump`, transforms all PII columns in-memory,
and writes the anonymized output to `/tmp/staging-snapshot-anon.dump`.

### 3. Import snapshot into staging DB

Restore the anonymized dump into the staging database, dropping and
recreating only the affected tables to avoid partial-state conflicts:

```bash
pg_restore "$STAGING_DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --format=custom \
  /tmp/staging-snapshot-anon.dump
```

### 4. Run migration scripts

After import, ensure the staging schema is current by running all pending
migrations:

```bash
npx prisma migrate deploy   # or the project's migration runner
```

Migrations must apply cleanly with zero errors before the job is considered
successful.

### 5. Gate

The entire job is wrapped in an environment-variable gate:

```bash
if [ "${STAGING_REFRESH_ENABLED}" != "true" ]; then
  echo "STAGING_REFRESH_ENABLED is not set to true — aborting." >&2
  exit 0
fi
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `STAGING_REFRESH_ENABLED` | Yes | Must be `true` to run; any other value is a no-op |
| `PROD_DATABASE_URL` | Yes | Read-only replica connection string for production |
| `STAGING_DATABASE_URL` | Yes | Connection string for staging DB |

## Failure Handling

- On any step failure the job exits non-zero and sends an alert to the
  `#ops-alerts` Slack channel via the `notify-ops-failure` helper.
- Temporary dump files (`/tmp/prod-snapshot.dump`,
  `/tmp/staging-snapshot-anon.dump`) are deleted on both success and failure
  via a `trap` to prevent PII from persisting on the CI runner.

## Linked Documents

- [Environment data policy](./environment-data-policy.md)
- [Secrets management runbook](./secrets-management-runbook.md)
- [Migration rollback drill](./migration-rollback-drill.md)
