-- AlterTable: comment moderation (hide/edit) and replies
ALTER TABLE "claim_comments" ADD COLUMN "hidden_at" TIMESTAMP(3);
ALTER TABLE "claim_comments" ADD COLUMN "edited_at" TIMESTAMP(3);
ALTER TABLE "claim_comments" ADD COLUMN "parent_id" TEXT;
