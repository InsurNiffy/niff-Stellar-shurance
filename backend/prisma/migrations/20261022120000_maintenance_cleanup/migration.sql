-- Feature flag expiry for scheduled maintenance cleanup
ALTER TABLE "feature_flags" ADD COLUMN "expires_at" TIMESTAMP(3);
CREATE INDEX "feature_flags_expires_at_idx" ON "feature_flags"("expires_at");

-- Archive of resolved claims older than 2 years
CREATE TABLE "claim_archive" (
    "id" INTEGER NOT NULL,
    "policy_id" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL,
    "amount" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "resolved_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "claim_archive_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "claim_archive_policy_id_idx" ON "claim_archive"("policy_id");
CREATE INDEX "claim_archive_archived_at_idx" ON "claim_archive"("archived_at");
