import { Injectable, LoggerService, Scope } from '@nestjs/common';
import { createLogger, format, transports, Logger } from 'winston';
import { ConfigService } from '@nestjs/config';

/**
 * Sensitive header / field names that must never appear in log output.
 * Winston's printf formatter calls redactFields() before serialising.
 */
const REDACTED_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
  'x-forwarded-authorization',
]);

/** Top-level request body fields that must never be logged. */
const REDACTED_BODY_FIELDS = new Set([
  'password',
  'secret',
  'privateKey',
  'mnemonic',
  'seed',
  'signature', // Ed25519 sig — not PII but sensitive
]);

export function redactHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = REDACTED_HEADERS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}

export function redactBody(
  body: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object') return body;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = REDACTED_BODY_FIELDS.has(k) ? '[REDACTED]' : v;
  }
  return out;
}

/**
 * AppLoggerService — structured JSON logger backed by Winston.
 *
 * Log field dictionary (for centralised logging stacks):
 *
 * | Field        | Type    | Description                                      |
 * |--------------|---------|--------------------------------------------------|
 * | timestamp    | ISO8601 | UTC timestamp of the log entry                   |
 * | level        | string  | error / warn / info / debug                      |
 * | message      | string  | Human-readable summary                           |
 * | service      | string  | Always "niffyinsure-api"                         |
 * | requestId    | string  | Correlation ID (x-request-id or generated)       |
 * | method       | string  | HTTP verb                                        |
 * | url          | string  | Request path (no query string for PII safety)    |
 * | statusCode   | number  | HTTP response status                             |
 * | durationMs   | number  | Request duration in milliseconds                 |
 * | ip           | string  | Client IP (hashed in production if IP_HASH_SALT) |
 * | userAgent    | string  | User-Agent header value                          |
 * | context      | string  | NestJS class/module name                         |
 * | stack        | string  | Error stack trace (error level only)             |
 * | rpcMethod    | string  | Soroban RPC method name (RPC log entries)        |
 * | rpcStatus    | string  | "success" or "error"                             |
 *
 * Fields intentionally OMITTED:
 *  - Authorization / Cookie headers (redacted)
 *  - Request/response bodies (never logged)
 *  - IPFS file contents
 *  - Private keys, seeds, mnemonics
 *
 * OpenTelemetry extension point:
 *  When OTel is added, inject TraceId/SpanId into each log entry here
 *  by reading from the active span context.
 */
@Injectable({ scope: Scope.DEFAULT })
export class AppLoggerService implements LoggerService {
  private readonly winston: Logger;

  constructor(private readonly config?: ConfigService) {
    const level = config?.get<string>('LOG_LEVEL') ?? process.env.LOG_LEVEL ?? 'info';

    this.winston = createLogger({
      level,
      format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        // OTel extension point: add traceId/spanId here from active context
        format.json(),
      ),
      defaultMeta: { service: 'niffyinsure-api' },
      transports: [new transports.Console()],
    });
  }

  log(message: string, context?: string) {
    this.winston.info(message, { context });
  }

  error(message: string, trace?: string, context?: string) {
    this.winston.error(message, { context, stack: trace });
  }

  warn(message: string, context?: string) {
    this.winston.warn(message, { context });
  }

  debug(message: string, context?: string) {
    this.winston.debug(message, { context });
  }

  verbose(message: string, context?: string) {
    this.winston.verbose(message, { context });
  }

  /** Structured log with arbitrary extra fields. */
  structured(
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    fields: Record<string, unknown>,
  ) {
    this.winston.log(level, message, fields);
  }
}
