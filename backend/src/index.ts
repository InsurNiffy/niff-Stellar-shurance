import express from "express";
import policyRoutes from "./routes/policy.routes";
import webhookRoutes from "./routes/webhook.routes";
import { errorHandler } from "./middleware/errorHandler";
import { openapiSpec } from "./openapi/spec";
import { seedDevData } from "./db/seed";

const app = express();

// Webhook routes MUST be mounted before express.json() so the raw-body
// capture middleware in webhook.routes.ts can read the raw bytes for HMAC.
app.use("/webhooks", webhookRoutes);

// JSON body parsing for all other routes
app.use(express.json());

// Seed dev data (no-op in test — tests call _resetStore + insert their own data)
if (process.env.NODE_ENV !== "test") {
  seedDevData();
}

// ── Routes ───────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/openapi.json", (_req, res) => res.json(openapiSpec));
app.use("/policies", policyRoutes);

// ── Error handler (must be last) ─────────────────────────────────────────────
app.use(errorHandler);

export default app;
