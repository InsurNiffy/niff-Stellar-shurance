-- Add evidence metadata table to store IPFS CID, file size, and MIME type
CREATE TABLE "evidence_metadata" (
    "id" SERIAL NOT NULL,
    "claim_id" INTEGER NOT NULL,
    "cid" TEXT,
    "url" TEXT,
    "file_size_bytes" INTEGER,
    "mime_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_metadata_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "evidence_metadata_claim_id_key" ON "evidence_metadata"("claim_id");
CREATE INDEX "evidence_metadata_claim_id_idx" ON "evidence_metadata"("claim_id");

ALTER TABLE "evidence_metadata" ADD CONSTRAINT "evidence_metadata_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
