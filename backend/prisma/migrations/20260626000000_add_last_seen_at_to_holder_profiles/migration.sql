-- AlterTable: holder_profiles — add last_seen_at for dormant account detection

ALTER TABLE "holder_profiles" ADD COLUMN "last_seen_at" TIMESTAMP(3);

CREATE INDEX "holder_profiles_last_seen_at_idx" ON "holder_profiles"("last_seen_at");
