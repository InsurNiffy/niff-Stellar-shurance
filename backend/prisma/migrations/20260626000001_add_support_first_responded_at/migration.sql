-- Migration: add first_responded_at to support_tickets
ALTER TABLE "support_tickets" ADD COLUMN "first_responded_at" TIMESTAMP(3);
CREATE INDEX "support_tickets_first_responded_at_idx" ON "support_tickets"("first_responded_at");
