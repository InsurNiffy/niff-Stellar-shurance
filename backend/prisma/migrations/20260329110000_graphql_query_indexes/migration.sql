-- GraphQL nested policy -> claims and claim -> votes lookups.
-- These composite indexes mirror the actual filtered query shapes used by the
-- GraphQL loaders and keep staging load-test fan-out predictable.

CREATE INDEX IF NOT EXISTS "claims_policyId_deleted_at_createdAt_idx"
  ON "claims"("policyId", "deleted_at", "createdAt");

CREATE INDEX IF NOT EXISTS "votes_claimId_deleted_at_idx"
  ON "votes"("claimId", "deleted_at");
