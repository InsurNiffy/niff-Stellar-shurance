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
