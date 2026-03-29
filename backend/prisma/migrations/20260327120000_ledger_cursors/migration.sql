-- CreateTable
CREATE TABLE "ledger_cursors" (
    "network" TEXT NOT NULL,
    "last_processed_ledger" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_cursors_pkey" PRIMARY KEY ("network")
);

-- CreateTable
CREATE TABLE "ledger_gap_alert_dedup" (
    "network" TEXT NOT NULL,
    "last_fired_at" TIMESTAMP(3) NOT NULL,
    "last_gap_size" INTEGER,
    "last_processed_ledger" INTEGER,
    "latest_ledger" INTEGER,

    CONSTRAINT "ledger_gap_alert_dedup_pkey" PRIMARY KEY ("network")
);

-- Seed default network from legacy indexer_state (if present)
INSERT INTO "ledger_cursors" ("network", "last_processed_ledger", "updated_at")
SELECT 'testnet', COALESCE((SELECT MAX("last_ledger") FROM "indexer_state"), 0), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "ledger_cursors" WHERE "network" = 'testnet');
