-- Appeal schema (#1318 / #1354)
-- Adds ClaimStatus appeal variants and appeal tracking columns.
--
-- Postgres safety: environments run Postgres 15/16 (see backend/docker-compose.yml
-- and staging RDS). `ALTER TYPE ... ADD VALUE IF NOT EXISTS` is supported since
-- PG 9.3. On PG 12+ the statement is allowed inside a transaction; the new
-- enum labels are usable only after the migration commits.

ALTER TYPE "ClaimStatus" ADD VALUE IF NOT EXISTS 'UNDER_APPEAL';
ALTER TYPE "ClaimStatus" ADD VALUE IF NOT EXISTS 'APPEAL_APPROVED';
ALTER TYPE "ClaimStatus" ADD VALUE IF NOT EXISTS 'APPEAL_REJECTED';

ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "appeals_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "appeal_tx_hash" TEXT;

-- Backfill: existing rows (including REJECTED) receive appeals_count = 0 via the
-- column DEFAULT. No UPDATE rewrite required.
