ALTER TABLE "support_tickets" ADD COLUMN "wallet_address" TEXT;

CREATE INDEX "support_tickets_wallet_address_idx" ON "support_tickets"("wallet_address");
