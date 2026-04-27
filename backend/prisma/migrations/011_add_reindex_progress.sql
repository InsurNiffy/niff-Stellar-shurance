-- Create reindex progress tracking table
CREATE TABLE "reindex_progress" (
    "job_id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "start_ledger" INTEGER NOT NULL DEFAULT 0,
    "target_ledger" INTEGER NOT NULL DEFAULT 0,
    "current_ledger" INTEGER NOT NULL DEFAULT 0,
    "total_events" INTEGER NOT NULL DEFAULT 0,
    "processed_events" INTEGER NOT NULL DEFAULT 0,
    "start_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_update" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "reindex_progress_pkey" PRIMARY KEY ("job_id")
);

-- Create index for network queries
CREATE INDEX "reindex_progress_network_idx" ON "reindex_progress"("network");

-- Create index for status queries
CREATE INDEX "reindex_progress_status_idx" ON "reindex_progress"("status");

-- Create index for last_update queries
CREATE INDEX "reindex_progress_last_update_idx" ON "reindex_progress"("last_update");
