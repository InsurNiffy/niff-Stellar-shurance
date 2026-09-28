-- AlterTable: add deleted_by to claim_comments for audit trail
ALTER TABLE "claim_comments" ADD COLUMN "deleted_by" TEXT;

-- CreateIndex
CREATE INDEX "claim_comments_deleted_by_idx" ON "claim_comments"("deleted_by");