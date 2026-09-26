-- Appeal open deadline (mirrors on-chain appeal_open_deadline_ledger) for reminder scans.
ALTER TABLE "claims" ADD COLUMN "appeal_open_deadline_ledger" INTEGER;

CREATE INDEX "claims_status_appeal_open_deadline_ledger_idx"
  ON "claims"("status", "appeal_open_deadline_ledger");

-- Offline mirror of on-chain snapshot_appeal_voters for appeal-round electorate.
CREATE TABLE "appeal_voter_snapshots" (
    "id" SERIAL NOT NULL,
    "claim_id" INTEGER NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "appeals_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appeal_voter_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "appeal_voter_snapshots_claim_id_wallet_address_appeals_count_key"
  ON "appeal_voter_snapshots"("claim_id", "wallet_address", "appeals_count");

CREATE INDEX "appeal_voter_snapshots_claim_id_appeals_count_idx"
  ON "appeal_voter_snapshots"("claim_id", "appeals_count");

ALTER TABLE "appeal_voter_snapshots"
  ADD CONSTRAINT "appeal_voter_snapshots_claim_id_fkey"
  FOREIGN KEY ("claim_id") REFERENCES "claims"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
