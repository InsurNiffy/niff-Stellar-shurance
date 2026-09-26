# Appeal Enum Migration Rollout Plan

> Last verified: 2026-08-29  
> Related: #1354, migration `20260829100000_add_appeal_claim_status_and_columns`

## Summary

Hand-authored Prisma migration adds:

- `ClaimStatus` enum values: `UNDER_APPEAL`, `APPEAL_APPROVED`, `APPEAL_REJECTED`
- Columns: `claims.appeals_count` (default `0`), `claims.appeal_tx_hash` (nullable)

Feature flag `claims_appeal_enabled` stays **off** until the schema is live in that
environment (see `docs/feature-flags.md`).

## Postgres version safety

| Environment | Expected Postgres | Verdict |
|---|---|---|
| Local / CI (`backend/docker-compose.yml`) | **16** | Safe |
| Staging RDS | **15+** (baseline reports use PG 15) | Safe |
| Production | **15+** | Safe |

`ALTER TYPE ... ADD VALUE IF NOT EXISTS`:

- Supported since **PostgreSQL 9.3**
- On **PG 12+** (all our envs): allowed inside a transaction; new labels are
  usable only **after commit** — Prisma `migrate deploy` is fine
- Do **not** run on PG ≤11 inside a transaction without splitting statements

Confirm before each env:

```bash
psql "$DATABASE_URL" -c "SHOW server_version;"
```

## Migration order (per environment)

1. **Backup** — `pg_dump` / verify latest automated backup (see disaster-recovery-runbook).
2. **Deploy migration only** (app still on previous build is OK for additive enum/columns):

   ```bash
   cd backend
   npx prisma migrate status
   npx prisma migrate deploy
   ```

3. **Verify schema**:

   ```bash
   psql "$DATABASE_URL" -c "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'ClaimStatus' ORDER BY enumsortorder;"
   psql "$DATABASE_URL" -c "\d claims" | grep -E 'appeals_count|appeal_tx_hash|status'
   ```

4. **Backfill needs** — **none**. `appeals_count INTEGER NOT NULL DEFAULT 0` applies
   to existing rows (including historical `REJECTED` claims) without an `UPDATE`.
5. **Deploy backend** build that writes/reads the new statuses (indexer + appeal APIs).
6. **Enable** `claims_appeal_enabled` for that environment (change ticket).
7. **Smoke**: build appeal tx on a staging rejected claim; confirm indexer sets
   `UNDER_APPEAL` / terminal `APPEAL_*` from chain events.

## Staged rollout checklist

### Dev

- [ ] Backup / disposable DB OK
- [ ] `prisma migrate deploy`
- [ ] Confirm enum labels + columns
- [ ] Deploy API + indexer
- [ ] Turn on `claims_appeal_enabled`
- [ ] Run appeal e2e / manual open → finalize path

### Staging

- [ ] Change ticket + backup confirmation
- [ ] `SHOW server_version` ≥ 15
- [ ] `prisma migrate deploy` in maintenance window (short; additive)
- [ ] Deploy API + indexer **before** enabling the flag for external testers
- [ ] Enable `claims_appeal_enabled`
- [ ] Load test `loadtests/appeal-flow.js` (baselines in `backend/docs/perf/`)
- [ ] Spot-check reconciliation job still green

### Production

- [ ] Staging soak ≥ 24h with no appeal schema defects
- [ ] Backup verified restorable
- [ ] `prisma migrate deploy` (additive; low lock risk — `ADD VALUE` / `ADD COLUMN`)
- [ ] Deploy API + indexer
- [ ] Enable `claims_appeal_enabled` gradually (internal → %)
- [ ] Monitor indexer lag, appeal metrics, error rates
- [ ] On-call briefed with [appeal-incident-runbook.md](../ops/appeal-incident-runbook.md)

## Rollback plan

Enum **values cannot be removed** safely with a simple reverse migration while rows
reference them. Prefer **forward fixes**.

| Stage | Rollback |
|---|---|
| Migration deployed, **no** rows use `APPEAL_*` / `UNDER_APPEAL`, flag off | Leave columns/enum in place (harmless). Optionally keep app on previous build. Do **not** attempt `ALTER TYPE ... RENAME/DROP VALUE` in prod. |
| App deployed, flag on, bad behavior | Disable `claims_appeal_enabled` immediately; stop appeal traffic |
| Bad rows written | Disable flag; fix forward (reindex / admin tools); see migration-rollback-procedure.md for dump restore only if catastrophic |

Emergency restore: follow `backend/docs/migration-rollback-procedure.md` (backup → scale down → restore → migrate to last-good → scale up). Restoring a pre-migration dump drops appeal columns/values — only if no dependency on new data.

## Sign-off

| Env | Migrated by | Date | Flag enabled |
|---|---|---|---|
| Dev | | | |
| Staging | | | |
| Prod | | | |
