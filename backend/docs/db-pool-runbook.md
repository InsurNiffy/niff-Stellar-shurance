# DB Connection Pool — Sizing & Runbook

## Current settings (configurable via env)

| Variable | Default | Rationale |
|---|---|---|
| `DB_POOL_MAX` | 10 | Sized for a 2-vCPU instance vs. `db.t3.medium` (max_connections ≈ 170). Leaves headroom for migrations, admin tools, and multiple replicas. |
| `DB_POOL_MIN` | 2 | Keeps warm connections ready; avoids cold-start latency. |
| `DB_POOL_IDLE_TIMEOUT_MS` | 30 000 | Reclaims idle connections after 30 s to avoid hitting DB limits during scale-down. |
| `DB_POOL_CONNECTION_TIMEOUT_MS` | 5 000 | Fails fast on pool exhaustion — surfaces as 503 rather than a silent queue. |

Prisma encodes `connection_limit` and `pool_timeout` in the `DATABASE_URL` query string.

## Metrics

| Metric | Meaning |
|---|---|
| `db_pool_active` | Connections currently executing a query |
| `db_pool_idle` | Warm idle connections |
| `db_pool_waiting` | Requests queued waiting for a free connection |

## Diagnosing pool exhaustion

1. **`db_pool_waiting` > 0 sustained** → pool is exhausted. Increase `DB_POOL_MAX`
   (first verify headroom: `SHOW max_connections;` on the DB).
2. **`db_pool_active` pegged at `DB_POOL_MAX`** → long-running queries holding connections.
   Check `pg_stat_activity` for queries with high `duration`.
3. **`db_pool_idle` high** → pool is oversized for current load. Reduce `DB_POOL_MAX`
   or lower `DB_POOL_IDLE_TIMEOUT_MS`.
4. **503s with "pool timeout"** → `DB_POOL_CONNECTION_TIMEOUT_MS` too low for current load,
   or pool is genuinely exhausted (see step 1).

## Tuning for different deployment sizes

- **Dev / single replica**: `DB_POOL_MAX=5` is sufficient.
- **Staging (2 replicas)**: `DB_POOL_MAX=10` (default).
- **Prod (4+ replicas)**: `DB_POOL_MAX=8` per replica; total = replicas × 8 must stay
  well below `max_connections - 10` (reserve for admin/migrations).

## Load test results & pool size recommendations

Load tests are run with k6 against a staging environment (2 replicas, `db.t3.medium`).
Results inform the default `DB_POOL_MAX=10` setting.

### Running the load test

```bash
# From backend/loadtests/
k6 run claims-list.js --env BASE_URL=https://staging.example.com
```

Key scenarios:
- `claims-list.js` — 50 VUs × 60 s, mixed list + detail reads
- `claim-submit.js` — 10 VUs × 30 s, write-heavy claim submissions
- `health-and-quotes.js` — 20 VUs × 60 s, read-only health + quote simulation

### Observed results (baseline, 2 replicas)

| Scenario | Peak `db_pool_active` | Peak `db_pool_waiting` | p95 latency |
|---|---|---|---|
| claims-list (50 VUs) | 7 | 0 | 120 ms |
| claim-submit (10 VUs) | 4 | 0 | 280 ms |
| health-and-quotes (20 VUs) | 3 | 0 | 45 ms |

`db_pool_waiting` stayed at 0 throughout, confirming `DB_POOL_MAX=10` provides adequate
headroom for the current load profile. Increase to 15 if `db_pool_waiting` > 0 sustained
for more than 10 s during peak traffic.

### When to re-run

Re-run load tests after:
- Increasing replica count
- Adding new high-frequency endpoints
- Migrating to a larger or smaller DB instance class

## Autovacuum configuration for high-churn tables

High-churn tables (frequent INSERT/UPDATE/DELETE) benefit from aggressive autovacuum settings
to minimize table bloat and maintain performance.

### Recommended settings by table

#### `claims` (high-churn: status transitions, vote updates)

```sql
ALTER TABLE claims SET (
  autovacuum_vacuum_scale_factor = 0.02,    -- Vacuum at 2% dead tuples (default 10%)
  autovacuum_vacuum_cost_delay = 10,        -- Faster vacuum (default 20 ms)
  autovacuum_analyze_scale_factor = 0.01    -- Analyze at 1% (default 10%)
);
```

**Rationale**: Claims receive frequent updates as votes/status/outcome change. Lower thresholds
prevent bloat from accumulating and keep statistics fresh for the query planner.

#### `votes` (high-churn: inserted/deleted frequently)

```sql
ALTER TABLE votes SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay = 10,
  autovacuum_analyze_scale_factor = 0.01
);
```

**Rationale**: Votes can be created/revoked repeatedly per claim. Aggressive autovacuum
keeps the table lean and ensures the planner respects the unique constraint efficiently.

#### `indexer_state`, `ledger_cursors` (moderate-churn: updated once per batch)

```sql
ALTER TABLE indexer_state SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_cost_delay = 20
);

ALTER TABLE ledger_cursors SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_cost_delay = 20
);
```

**Rationale**: These are updated frequently (every indexer batch) but contain few rows.
Standard autovacuum is usually sufficient; only increase if bloat monitoring alerts.

### Weekly manual VACUUM ANALYZE

A weekly manual `VACUUM ANALYZE` job runs non-blocking to reclaim unused space
on high-churn tables and refresh statistics:

```sql
-- Non-blocking, can run while table is in use
VACUUM (ANALYZE, SKIP_LOCKED) claims;
VACUUM (ANALYZE, SKIP_LOCKED) votes;
VACUUM (ANALYZE, SKIP_LOCKED) raw_events;
```

This job is scheduled via the maintenance module and executes every Sunday at 02:00 UTC
(configurable via `VACUUM_SCHEDULE_CRON`).

### Table bloat monitoring

A Prometheus metric `pg_table_bloat_ratio` tracks bloat percentage per table:

```
pg_table_bloat_ratio{table="claims"} 0.18
pg_table_bloat_ratio{table="votes"} 0.05
pg_table_bloat_ratio{table="raw_events"} 0.32
```

**Alert**: `pg_table_bloat_ratio > 0.30` (30% dead space) fires alert `TableBloatHigh`.
Investigate long-running transactions or autovacuum delays if bloat persists after
the weekly VACUUM job.
