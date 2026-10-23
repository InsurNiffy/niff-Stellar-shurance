import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { STATUS_CODES } from 'http';
import { AppException, getCatalogEntry, ProblemDetailDto } from '../errors';

/**
 * Maps raw Stellar / Soroban error strings to catalog codes.
 * Keeps blockchain internals out of client-facing responses.
 */
const STELLAR_ERROR_MAP: Record<string, string> = {
  tx_failed: 'TRANSACTION_FAILED',
  tx_bad_auth: 'SIGNATURE_INVALID',
  tx_insufficient_fee: 'INSUFFICIENT_FEE',
  tx_no_account: 'INVALID_WALLET_ADDRESS',
  op_no_trust: 'TRANSACTION_FAILED',
  op_underfunded: 'INSUFFICIENT_BALANCE',
  ledgerClosed: 'LEDGER_CLOSED',
  timeout: 'TIMEOUT_ERROR',
};

/** Catalog code used for the RFC 7807 `type` when an error carries no catalog code. */
const STATUS_FALLBACK_CODE: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  429: 'RATE_LIMIT_EXCEEDED',
  500: 'INTERNAL_ERROR',
};

function problemType(errorCode: string | undefined, status: number): string {
  const code =
    errorCode && getCatalogEntry(errorCode) ? errorCode : STATUS_FALLBACK_CODE[status];
  return code ? `/api/v1/errors#${code}` : 'about:blank';
}

function normalizeStellarError(raw: string): string | undefined {
  const lower = raw.toLowerCase();
  for (const [key, code] of Object.entries(STELLAR_ERROR_MAP)) {
    if (lower.includes(key.toLowerCase())) return code;
  }
  return undefined;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    // ── Resolve status ────────────────────────────────────────────────────
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // ── Resolve error code ────────────────────────────────────────────────
    let errorCode: string | undefined;
    let i18nKey: string | undefined;

    if (exception instanceof AppException) {
      // Catalog-backed exception — code and i18nKey are authoritative.
      errorCode = exception.errorCode;
      i18nKey = getCatalogEntry(errorCode)?.i18nKey;
    } else if (exception instanceof HttpException) {
      // Legacy HttpException: check if the response body carries a known code.
      const body = exception.getResponse();
      const bodyCode =
        typeof body === 'object' && body !== null
          ? (body as Record<string, unknown>).error
          : undefined;
      if (typeof bodyCode === 'string') {
        const entry = getCatalogEntry(bodyCode);
        if (entry) {
          errorCode = entry.code;
          i18nKey = entry.i18nKey;
        } else {
          errorCode = bodyCode;
        }
      }
    } else if (exception instanceof Error) {
      // Unknown error: try to map Stellar error strings.
      const stellarCode = normalizeStellarError(exception.message);
      if (stellarCode) {
        const entry = getCatalogEntry(stellarCode);
        errorCode = stellarCode;
        i18nKey = entry?.i18nKey;
      }
    }

    // ── Resolve message ───────────────────────────────────────────────────
    const rawResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const message =
      typeof rawResponse === 'string'
        ? rawResponse
        : (rawResponse as Record<string, unknown>).message ?? rawResponse;

    // ── Logging ───────────────────────────────────────────────────────────
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.debug(`${request.method} ${request.url} → ${status}`);
    }

    const details =
      typeof rawResponse === 'object' && rawResponse !== null
        ? (rawResponse as Record<string, unknown>).details
        : undefined;

    const problem: ProblemDetailDto = {
      type: problemType(errorCode, status),
      title: STATUS_CODES[status] ?? 'Error',
      status,
      detail: String(message),
      instance: request.url,
      extensions: {
        code: errorCode || 'INTERNAL_SERVER_ERROR',
        ...(i18nKey ? { i18nKey } : {}),
        ...(request.requestId ? { requestId: request.requestId } : {}),
        ...(details !== undefined ? { details } : {}),
      },
    };

    // RFC 7807 fields are top-level; the legacy envelope is kept for existing clients.
    response.status(status).json({
      ...problem,
      data: null,
      meta: {
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: request.url,
        ...(request.requestId ? { requestId: request.requestId } : {}),
      },
      errors: [
        {
          code: errorCode || 'INTERNAL_SERVER_ERROR',
          message: String(message),
          ...(i18nKey ? { i18nKey } : {}),
        },
      ],
    });
  }
}
