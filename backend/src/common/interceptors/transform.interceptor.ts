import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Standard API response envelope: { data, meta, errors }
 * Applied to all successful responses.
 */
export interface ApiEnvelope<T = unknown> {
  data: T;
  meta?: Record<string, unknown>;
  errors?: null | Array<{ code: string; message: string }>;
}

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((response) => {
        // Already an envelope, pass through
        if (this.isEnvelope(response)) {
          return response;
        }

        // Handle paginated responses with pagination field
        if (response && typeof response === 'object' && 'pagination' in response && 'data' in response) {
          const { pagination, data, ...rest } = response as {
            pagination: { total: number; next_cursor?: unknown };
            data: unknown;
            [key: string]: unknown;
          };
          return {
            data,
            meta: {
              total: pagination.total,
              cursor: pagination.next_cursor,
              ...rest,
            },
            errors: null,
          };
        }

        // Wrap plain responses
        return {
          data: response,
          meta: {},
          errors: null,
        };
      }),
    );
  }

  private isEnvelope(obj: unknown): boolean {
    return (
      obj !== null &&
      typeof obj === 'object' &&
      'data' in obj &&
      ('meta' in obj || 'errors' in obj)
    );
  }
}
