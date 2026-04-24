/**
 * Webhook routes.
 *
 * IMPORTANT: raw body capture middleware must run BEFORE express.json().
 * This router registers its own raw-body parser so the route is self-contained.
 *
 * Rate limiting is intentionally NOT applied here — webhook endpoints must
 * always accept provider retries. Providers use exponential backoff and will
 * retry on 429, but a missed 200 can cause duplicate deliveries. IP allowlisting
 * in the verifier is the appropriate access control for webhook endpoints.
 */

import { Router, Request, Response, NextFunction } from "express";
import {
  handleWebhook,
  getQueueStatsHandler,
  getDeliveryHistoryHandler,
  retryDeliveryHandler,
} from "../controllers/webhook.controller";

const router = Router();

/**
 * Capture raw body before JSON parsing — required for HMAC verification.
 * express.json() is applied globally in index.ts, but it runs after this
 * middleware captures the raw bytes.
 */
function captureRawBody(
  req: Request & { rawBody?: Buffer },
  _res: Response,
  next: NextFunction
): void {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    req.rawBody = Buffer.concat(chunks);
    // Parse JSON manually so both rawBody and req.body are available
    if (req.rawBody.length > 0) {
      try {
        req.body = JSON.parse(req.rawBody.toString("utf8"));
      } catch {
        req.body = {};
      }
    }
    next();
  });
  req.on("error", next);
}

/**
 * @openapi
 * /webhooks/{provider}:
 *   post:
 *     summary: Receive an authenticated webhook
 *     tags: [Webhooks]
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [github, stripe, generic] }
 *     responses:
 *       200:
 *         description: Accepted (or duplicate — no work enqueued)
 *       400:
 *         description: Invalid signature or replay attack
 *       403:
 *         description: IP not in allowlist
 *       404:
 *         description: Unknown provider
 */
router.post("/:provider", captureRawBody, handleWebhook);

/**
 * @openapi
 * /webhooks/queue/stats:
 *   get:
 *     summary: Queue observability stats
 *     tags: [Webhooks]
 *     responses:
 *       200:
 *         description: Current queue counts
 */
router.get("/queue/stats", getQueueStatsHandler);

/**
 * @openapi
 * /webhooks/deliveries:
 *   get:
 *     summary: Admin — recent delivery history (completed, failed, active, waiting)
 *     tags: [Webhooks]
 *     security: [{ adminToken: [] }]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 100, maximum: 500 }
 *     responses:
 *       200:
 *         description: Array of DeliveryRecord
 */
router.get("/deliveries", getDeliveryHistoryHandler);

/**
 * @openapi
 * /webhooks/deliveries/{jobId}/retry:
 *   post:
 *     summary: Admin — manually retry a failed delivery
 *     tags: [Webhooks]
 *     security: [{ adminToken: [] }]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Job re-queued
 *       404:
 *         description: Job not found
 */
router.post("/deliveries/:jobId/retry", retryDeliveryHandler);

export default router;
