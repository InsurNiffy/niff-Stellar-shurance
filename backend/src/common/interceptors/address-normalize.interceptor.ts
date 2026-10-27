import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tryNormalizeAddress } from '../utils/normalize-address';

/** Request-body keys that hold Stellar addresses (mirrors the Prisma address columns). */
const ADDRESS_KEYS = new Set([
  'holderAddress',
  'creatorAddress',
  'voterAddress',
  'walletAddress',
  'authorAddress',
  'receiverAddress',
  'subjectWalletAddress',
]);

export function normalizeAddressFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeAddressFields);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] =
        ADDRESS_KEYS.has(k) && typeof v === 'string'
          ? (tryNormalizeAddress(v) ?? v)
          : normalizeAddressFields(v);
    }
    return out;
  }
  return value;
}

/**
 * Normalizes all incoming Stellar addresses to the canonical storage form
 * (see normalizeAddress) before they reach handlers and DB writes.
 * Invalid values are left untouched so DTO validation reports them.
 */
@Injectable()
export class AddressNormalizeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ body?: unknown }>();
    if (req?.body && typeof req.body === 'object') {
      req.body = normalizeAddressFields(req.body);
    }
    return next.handle();
  }
}
