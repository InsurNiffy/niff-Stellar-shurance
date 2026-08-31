-- Migration: add ClaimSeverity enum and severity column to claims
CREATE TYPE "ClaimSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
ALTER TABLE "claims" ADD COLUMN "severity" "ClaimSeverity";
CREATE INDEX "claims_severity_idx" ON "claims"("severity");
