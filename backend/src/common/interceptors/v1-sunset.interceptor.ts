import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * Default sunset date for the v1 API surface.
 * Overridable via the V1_SUNSET_DATE environment variable (ISO 8601).
 */
const DEFAULT_V1_SUNSET_DATE = '2025-12-31T23:59:59Z';

/**
 * Adds `Sunset` and `Deprecation` headers to responses served by the v1 API,
 * announcing that the version is scheduled for removal.
 */
@Injectable()
export class V1SunsetInterceptor implements NestInterceptor {
  private readonly sunsetDate: string;

  constructor() {
    this.sunsetDate = process.env.V1_SUNSET_DATE || DEFAULT_V1_SUNSET_DATE;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse();

    if (response && typeof response.setHeader === 'function') {
      response.setHeader('Sunset', this.sunsetDate);
      response.setHeader('Deprecation', 'true');
    }

    return next.handle();
  }
}
