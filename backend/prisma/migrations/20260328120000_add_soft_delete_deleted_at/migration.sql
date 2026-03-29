-- Soft-delete columns for compliance and reindex-safe logical removal.
-- raw_events is intentionally unchanged (append-only audit / reindex source).

ALTER TABLE "policies" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "policies_deleted_at_idx" ON "policies"("deleted_at");

ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "claims_deleted_at_idx" ON "claims"("deleted_at");

ALTER TABLE "votes" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "votes_deleted_at_idx" ON "votes"("deleted_at");
