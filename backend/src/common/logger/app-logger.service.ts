import { Injectable, LoggerService, Scope } from '@nestjs/common';
import { createLogger, format, transports, Logger } from 'winston';
import { ConfigService } from '@nestjs/config';
import type { TransformableInfo } from 'logform';

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
  'apiKey',
  'privateKey',
  'mnemonic',
  'seed',
  'signature', // Ed25519 sig — not PII but sensitive
]);

const REDACTED_FIELD_TOKENS = [
  'secret',
  'token',
  'password',
  'api_key',
  'apikey',
  'private_key',
  'privatekey',
  'mnemonic',
  'seed',
  'cookie',
  'authorization',
  'jwt',
  'webhook',
];

const SECRET_ASSIGNMENT_PATTERN =
  /\b([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY|WEBHOOK(?:_URL|_SECRET)?))=([^\s,;]+)/g;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

function normalizeRedactionKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function shouldRedactField(key: string): boolean {
  const normalized = normalizeRedactionKey(key);
  return REDACTED_FIELD_TOKENS.some((token) =>
    normalized.includes(token.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()),
  );
}

export function redactMessageText(message: string): string {
  return message
    .replace(SECRET_ASSIGNMENT_PATTERN, '$1=[REDACTED]')
    .replace(BEARER_TOKEN_PATTERN, 'Bearer [REDACTED]');
}

export function redactValue<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return redactMessageText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry)) as T;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactMessageText(value.message),
      stack: value.stack ? redactMessageText(value.stack) : undefined,
    } as T;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const redacted: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(record)) {
      redacted[key] = shouldRedactField(key) ? '[REDACTED]' : redactValue(nestedValue);
    }
    return redacted as T;
  }

  return value;
}

function redactLogInfo(info: TransformableInfo): TransformableInfo {
  return redactValue(info);
}

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
    out[k] = REDACTED_BODY_FIELDS.has(k) ? '[REDACTED]' : redactValue(v);
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
    const level = config?.get<string>('LOG_LEVEL') ?? 'info';

    this.winston = createLogger({
      level,
      format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format((info) => redactLogInfo(info))(),
        // OTel extension point: add traceId/spanId here from active context
        format.json(),
      ),
      defaultMeta: { service: 'niffyinsure-api' },
      transports: [new transports.Console()],
    });
  }

  log(message: string, context?: string) {
    this.winston.info(redactMessageText(message), { context });
  }

  error(message: string, trace?: string, context?: string) {
    this.winston.error(redactMessageText(message), {
      context,
      stack: trace ? redactMessageText(trace) : undefined,
    });
  }

  warn(message: string, context?: string) {
    this.winston.warn(redactMessageText(message), { context });
  }

  debug(message: string, context?: string) {
    this.winston.debug(redactMessageText(message), { context });
  }

  verbose(message: string, context?: string) {
    this.winston.verbose(redactMessageText(message), { context });
  }

  /** Structured log with arbitrary extra fields. */
  structured(
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    fields: Record<string, unknown>,
  ) {
    this.winston.log(level, redactMessageText(message), redactValue(fields));
  }
}
