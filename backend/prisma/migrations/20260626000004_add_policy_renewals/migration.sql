-- Migration: add policy_renewals table for renewal analytics
CREATE TABLE "policy_renewals" (
    "id" TEXT NOT NULL,
    "policy_composite_id" TEXT NOT NULL,
    "holder_address" TEXT NOT NULL,
    "policy_type" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "previous_end_ledger" INTEGER NOT NULL,
    "new_end_ledger" INTEGER NOT NULL,
    "premium_paid_stroops" TEXT NOT NULL,
    "renewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "policy_renewals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "policy_renewals_policy_composite_id_idx" ON "policy_renewals"("policy_composite_id");
CREATE INDEX "policy_renewals_policy_type_region_idx" ON "policy_renewals"("policy_type", "region");
CREATE INDEX "policy_renewals_renewed_at_idx" ON "policy_renewals"("renewed_at");
