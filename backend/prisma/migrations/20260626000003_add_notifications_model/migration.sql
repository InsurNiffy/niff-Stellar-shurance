-- Migration: add notifications table
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "acknowledged_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notifications_userId_acknowledged_at_idx" ON "notifications"("userId", "acknowledged_at");
CREATE INDEX "notifications_expires_at_acknowledged_at_idx" ON "notifications"("expires_at", "acknowledged_at");
