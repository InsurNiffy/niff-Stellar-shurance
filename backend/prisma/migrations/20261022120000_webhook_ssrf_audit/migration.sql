-- Daily SSRF re-validation audit for webhook subscriptions (#1654)
ALTER TABLE "tenants" ADD COLUMN "contact_email" TEXT;

CREATE TABLE "webhook_ssrf_audit" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "reason" TEXT,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_ssrf_audit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "webhook_ssrf_audit_subscription_id_idx" ON "webhook_ssrf_audit"("subscription_id");
CREATE INDEX "webhook_ssrf_audit_checked_at_idx" ON "webhook_ssrf_audit"("checked_at");
