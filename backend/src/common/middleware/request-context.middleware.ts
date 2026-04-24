import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { trace, context as otelContext, SpanStatusCode } from '@opentelemetry/api';
import { MetricsService } from '../../metrics/metrics.service';
import { AppLoggerService, redactHeaders } from '../logger/app-logger.service';

/**
 * RequestContextMiddleware
 *
 * Responsibilities:
 *  1. Attach / propagate a requestId from `x-request-id` header or generate one.
 *  2. Echo the requestId back in the response as `x-request-id`.
 *  3. Emit structured JSON request/response log entries (no body, no PII).
 *  4. Record HTTP latency and status metrics via MetricsService.
 *
 * The requestId is stored on `req.requestId` so downstream handlers and the
 * exception filter can include it in error responses.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly metrics: MetricsService,
    private readonly logger: AppLoggerService,
  ) {}

  use(req: Request & { requestId?: string }, res: Response, next: NextFunction) {
    const requestId =
      (req.headers['x-request-id'] as string | undefined)?.trim() ||
      randomUUID();

    // Attach to request so guards/filters/services can read it
    req.requestId = requestId;

    // Echo back so clients can correlate
    res.setHeader('x-request-id', requestId);

    // Propagate requestId as a span attribute on the active OTel span (if any)
    const activeSpan = trace.getActiveSpan()
    if (activeSpan) {
      activeSpan.setAttribute('request.id', requestId)
    }

    const start = Date.now();

    this.logger.structured('info', 'request_received', {
      requestId,
      method: req.method,
      url: req.path, // path only — no query string to avoid leaking tokens
      ip: req.ip ?? req.socket?.remoteAddress,
      userAgent: req.get('user-agent'),
      headers: redactHeaders(req.headers as Record<string, unknown>),
    });

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      const route = this.metrics.normaliseRoute(req.route?.path ?? req.path);

      this.logger.structured('info', 'request_completed', {
        requestId,
        method: req.method,
        route,
        statusCode: res.statusCode,
        durationMs,
        contentLength: res.get('content-length') ?? 0,
      });

      this.metrics.recordHttpRequest({
        method: req.method,
        route,
        statusCode: res.statusCode,
        durationMs,
      });
    });

    next();
  }
}
