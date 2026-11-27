import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorCatalog, getCatalogEntry, isKnownErrorCode } from '../errors/error-catalog';

interface ErrorResponseBody {
  statusCode: number;
  code: string;
  i18nKey: string;
  message: string;
  path?: string;
  timestamp: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body = this.buildErrorBody(exception, request);

    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${body.statusCode} ${body.code}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(body.statusCode).json(body);
  }

  private buildErrorBody(exception: unknown, request: Request): ErrorResponseBody {
    const timestamp = new Date().toISOString();
    const path = request?.url;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = this.resolveCode(exception, status);
      const entry = getCatalogEntry(code);
      return {
        statusCode: entry.httpStatus,
        code,
        i18nKey: entry.i18nKey,
        message: this.resolveMessage(exception, entry.description),
        path,
        timestamp,
      };
    }

    const entry = ErrorCatalog.INTERNAL_ERROR;
    return {
      statusCode: entry.httpStatus,
      code: 'INTERNAL_ERROR',
      i18nKey: entry.i18nKey,
      message: entry.description,
      path,
      timestamp,
    };
  }

  private resolveCode(exception: HttpException, status: number): string {
    const payload = exception.getResponse();
    if (payload && typeof payload === 'object') {
      const candidate = (payload as Record<string, unknown>).code;
      if (typeof candidate === 'string' && isKnownErrorCode(candidate)) {
        return candidate;
      }
    }
    return this.codeForStatus(status);
  }

  private codeForStatus(status: number): string {
    for (const [code, entry] of Object.entries(ErrorCatalog)) {
      if (entry.httpStatus === status) {
        return code;
      }
    }
    return 'INTERNAL_ERROR';
  }

  private resolveMessage(exception: HttpException, fallback: string): string {
    const payload = exception.getResponse();
    if (typeof payload === 'string') {
      return payload;
    }
    if (payload && typeof payload === 'object') {
      const message = (payload as Record<string, unknown>).message;
      if (typeof message === 'string') {
        return message;
      }
      if (Array.isArray(message)) {
        return message.join('; ');
      }
    }
    return fallback;
  }
}
