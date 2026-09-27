import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OutboundWebhookJob } from './outbound.queue';
import { signRawBody, SIGNATURE_HEADER } from './signature';
import { backoffDelayMs, isExhausted } from './backoff';

/** Injection token for the HTTP poster — tests inject a fake transport. */
export const WEBHOOK_HTTP_POST = 'WEBHOOK_HTTP_POST';

export interface HttpPostResponse {
  status: number;
}

export type HttpPostFn = (
  url: string,
  body: string,
  headers: Record<string, string>,
) => Promise<HttpPostResponse>;

export interface DeliveryJob extends OutboundWebhookJob {
  /** HMAC secret used to sign the payload. */
  secret?: string;
  /** 1-based attempt number. */
  attempt?: number;
}

export interface DeliveryResult {
  success: boolean;
  responseCode?: number;
  error?: string;
  signature: string;
}

const defaultHttpPost: HttpPostFn = async (url, body, headers) => {
  const { default: axios } = await import('axios');
  const res = await axios.post(url, body, { headers, timeout: 10_000, validateStatus: () => true });
  return { status: res.status };
};

/**
 * Signs, posts and logs a single outbound webhook delivery attempt (#1484).
 *
 * Every attempt — successful or not — appends a `WebhookDelivery` row with the
 * response code so partners can audit delivery history.
 */
@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(WEBHOOK_HTTP_POST) private readonly httpPost: HttpPostFn = defaultHttpPost,
  ) {}

  /** Performs one delivery attempt and records it. Never throws. */
  async deliver(job: DeliveryJob): Promise<DeliveryResult> {
    const rawBody = JSON.stringify(job.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = job.secret
      ? signRawBody(job.secret, rawBody, timestamp)
      : '';
    const attempt = job.attempt ?? 1;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Event-Type': job.eventType,
      'X-Idempotency-Key': job.idempotencyKey,
      'X-Niffy-Timestamp': String(timestamp),
      ...(signature && { [SIGNATURE_HEADER]: signature }),
    };

    let result: DeliveryResult;
    try {
      const res = await this.httpPost(job.targetUrl, rawBody, headers);
      const success = res.status >= 200 && res.status < 300;
      result = {
        success,
        responseCode: res.status,
        error: success ? undefined : `HTTP ${res.status}`,
        signature,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = { success: false, error: message, signature };
    }

    await this.recordDelivery({
      subscriptionId: null,
      targetUrl: job.targetUrl,
      eventType: job.eventType,
      idempotencyKey: job.idempotencyKey,
      attempt,
      success: result.success,
      responseCode: result.responseCode ?? null,
      errorMessage: result.error ?? null,
    });

    if (!result.success) {
      const delay = backoffDelayMs(attempt);
      const exhausted = isExhausted(attempt);
      this.logger.warn(
        `[outbound-webhook] delivery failed url=${job.targetUrl} event=${job.eventType} ` +
          `attempt=${attempt} code=${result.responseCode ?? 'n/a'} ` +
          (exhausted ? 'retries exhausted' : `next retry in ${delay}ms`),
      );
    }

    return result;
  }

  /** Writes a delivery-log row. Swallows persistence errors (never fail a delivery on logging). */
  async recordDelivery(entry: {
    subscriptionId?: string | null;
    targetUrl: string;
    eventType: string;
    idempotencyKey: string;
    attempt: number;
    success: boolean;
    responseCode?: number | null;
    errorMessage?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.webhookDelivery.create({
        data: {
          subscriptionId: entry.subscriptionId ?? null,
          targetUrl: entry.targetUrl,
          eventType: entry.eventType,
          idempotencyKey: entry.idempotencyKey,
          attempt: entry.attempt,
          success: entry.success,
          responseCode: entry.responseCode ?? null,
          errorMessage: entry.errorMessage ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `[outbound-webhook] failed to persist delivery log: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Recent delivery log entries for a target URL (admin/partner view). */
  async deliveryLog(targetUrl: string, limit = 50) {
    return this.prisma.webhookDelivery.findMany({
      where: { targetUrl },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
