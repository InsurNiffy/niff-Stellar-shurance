-- Dead-letter queue for exhausted outbound webhook deliveries (#1635)
CREATE TABLE "webhook_dlq" (
    "id" TEXT NOT NULL,
    "target_url" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL,
    "last_error" TEXT,
    "failed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retried_at" TIMESTAMP(3),
    CONSTRAINT "webhook_dlq_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "webhook_dlq_failed_at_idx" ON "webhook_dlq"("failed_at");
CREATE INDEX "webhook_dlq_retried_at_idx" ON "webhook_dlq"("retried_at");
