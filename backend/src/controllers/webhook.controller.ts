/**
 * POST /webhooks/:provider
 * GET  /webhooks/queue/stats
 * GET  /webhooks/deliveries          — admin: delivery history
 * POST /webhooks/deliveries/:jobId/retry — admin: manual retry
 *
 * Flow:
 *   1. Parse :provider — reject unknown providers immediately.
 *   2. Read raw body (required for HMAC over exact bytes).
 *   3. IP allowlist check (inside verifyWebhook).
 *   4. Verify signature — reject with 400 on failure.
 *   5. Idempotency check — return 200 immediately for duplicates.
 *   6. Enqueue job — non-blocking.
 *   7. Return 200 immediately to satisfy provider retry expectations.
 *
 * Security notes:
 *   - Raw body is read before any JSON parsing to preserve exact bytes for HMAC.
 *   - Verification failures log only provider + reason, never secrets or bodies.
 *   - Constant-time comparison is used in all provider verifiers.
 *   - Timestamp validation prevents replay attacks within the tolerance window.
 *   - Admin endpoints (/deliveries) must be protected by admin auth middleware
 *     at the router level — this controller does not enforce auth itself.
 */

import { Request, Response, NextFunction } from "express";
import { WebhookProvider } from "../types/webhook";
import { verifyWebhook } from "../webhooks/verify";
import { isDuplicate } from "../webhooks/idempotency";
import { webhookQueue, getDeliveryHistory, retryFailedJob, getQueueStats } from "../webhooks/queue";
import { getWebhookConfig } from "../webhooks/config";

const SUPPORTED_PROVIDERS: WebhookProvider[] = ["github", "stripe", "generic"];

function getClientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

export function handleWebhook(
  req: Request & { rawBody?: Buffer },
  res: Response,
  next: NextFunction
): void {
  try {
    const { provider: providerParam } = req.params;

    if (!SUPPORTED_PROVIDERS.includes(providerParam as WebhookProvider)) {
      res.status(404).json({ error: "unknown_provider", message: `Provider "${providerParam}" is not supported.` });
      return;
    }

    const provider = providerParam as WebhookProvider;
    const rawBody: Buffer = req.rawBody ?? Buffer.from(JSON.stringify(req.body), "utf8");
    const config = getWebhookConfig()[provider];
    const clientIp = getClientIp(req);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsedBody: Record<string, any> =
      typeof req.body === "object" && req.body !== null ? req.body : {};

    const { result, idempotencyKey, eventType } = verifyWebhook({
      provider,
      rawBody,
      headers: req.headers,
      parsedBody,
      config,
      clientIp,
    });

    if (!result.ok) {
      console.warn(
        `[webhook] verification failed provider=${provider} reason=${result.reason} ip=${clientIp}`
      );
      const status = result.reason === "ip_blocked" ? 403 : 400;
      res.status(status).json({ error: result.reason });
      return;
    }

    const key = idempotencyKey ?? `${provider}:${Date.now()}`;
    if (idempotencyKey && isDuplicate(provider, idempotencyKey)) {
      console.info(`[webhook] duplicate delivery skipped provider=${provider} key=${idempotencyKey}`);
      res.status(200).json({ status: "duplicate" });
      return;
    }

    webhookQueue.add("webhook", {
      provider,
      idempotencyKey: key,
      eventType,
      payload: parsedBody,
      receivedAt: Math.floor(Date.now() / 1000),
    }).catch((err: unknown) => {
      console.error(`[webhook] queue error provider=${provider}`, err);
    });

    res.status(200).json({ status: "accepted" });
  } catch (err) {
    next(err);
  }
}

export async function getQueueStatsHandler(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await getQueueStats());
  } catch (err) {
    next(err);
  }
}

/** GET /webhooks/deliveries — admin: recent delivery history */
export async function getDeliveryHistoryHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10), 500);
    res.json(await getDeliveryHistory(limit));
  } catch (err) {
    next(err);
  }
}

/** POST /webhooks/deliveries/:jobId/retry — admin: manually retry a failed job */
export async function retryDeliveryHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await retryFailedJob(req.params.jobId);
    res.json({ status: "retried" });
  } catch (err) {
    next(err);
  }
}
