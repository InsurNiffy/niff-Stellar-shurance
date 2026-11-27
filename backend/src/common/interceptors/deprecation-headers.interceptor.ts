import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

export const DEPRECATION_KEY = 'deprecation';

export interface DeprecationOptions {
  /** ISO date (YYYY-MM-DD) on which the endpoint will be removed. */
  sunset: string;
  /** Optional link to migration documentation. */
  link?: string;
}

/**
 * Marks a route (controller or handler) as deprecated.
 * The DeprecationHeadersInterceptor reads this metadata and emits
 * `Deprecation` and `Sunset` response headers.
 */
export const Deprecated = (options: DeprecationOptions) =>
  SetMetadata(DEPRECATION_KEY, options);

@Injectable()
export class DeprecationHeadersInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<DeprecationOptions | undefined>(
      DEPRECATION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!options) {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse();
    const sunsetDate = new Date(options.sunset);
    const sunsetHeader = Number.isNaN(sunsetDate.getTime())
      ? options.sunset
      : sunsetDate.toUTCString();

    response.setHeader('Deprecation', 'true');
    response.setHeader('Sunset', sunsetHeader);
    if (options.link) {
      response.setHeader('Link', `<${options.link}>; rel="deprecation"`);
    }

    return next.handle().pipe(tap(() => undefined));
  }
}
