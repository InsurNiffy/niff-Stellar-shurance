/**
 * Adds Sunset and Deprecation headers to every response served under the v1
 * API path (i.e. URLs containing "/v1/"). This lets API clients detect the
 * upcoming removal and migrate before the sunset date — issue #890.
 */

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import {
  DEPRECATION_HEADER,
  DEPRECATED_API_SUNSET_HTTP_DATE,
  SUNSET_HEADER,
} from './api-versioning.constants';

@Injectable()
export class V1SunsetInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.path?.includes('/v1/')) {
      return next.handle();
    }

    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      tap(() => {
        res.setHeader(DEPRECATION_HEADER, 'true');
        res.setHeader(SUNSET_HEADER, DEPRECATED_API_SUNSET_HTTP_DATE);
      }),
    );
  }
}
