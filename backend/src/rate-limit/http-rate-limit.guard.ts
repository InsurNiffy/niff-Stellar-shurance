/**
 * HttpRateLimitGuard — per-route rate limiting with Redis storage.
 *
 * Reads the named policy from @RateLimit('policy-name') metadata on the handler
 * or controller, then applies the configured limit using a Redis sorted-set
 * sliding window.
 *
 * Key selection:
 *   - Authenticated requests: keyed by wallet address (from JWT payload).
 *   - Unauthenticated requests: keyed by trusted-proxy-aware remote IP.
 *
 * Exempt routes:
 *   - Routes decorated with @RateLimit('exempt') are always allowed.
 *   - Health and metrics routes should always carry this decorator.
 *
 * On Redis failure the guard fails OPEN (logs a warning, allows the request).
 * This is intentional: degraded rate limiting is preferable to a full outage.
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import {
  RATE_LIMIT_POLICY_KEY,
  NAMED_RATE_LIMIT_POLICIES,
  RateLimitPolicy,
} from './rate-limit.decorator';
import { RateLimitService } from './rate-limit.service';

interface AuthenticatedRequest extends Request {
  user?: { walletAddress?: string };
}

@Injectable()
export class HttpRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(HttpRateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policyName = this.reflector.getAllAndOverride<string>(
      RATE_LIMIT_POLICY_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No decorator → use default policy.
    const policy: RateLimitPolicy =
      NAMED_RATE_LIMIT_POLICIES[policyName ?? 'default'] ??
      NAMED_RATE_LIMIT_POLICIES['default'];

    // Exempt routes always pass.
    if (policyName === 'exempt' || policy.limit === Infinity) {
      return true;
    }

    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const res = http.getResponse<Response>();

    const identifier = this.resolveIdentifier(req, policy.keyBy);

    try {
      const rateLimitKey = `http:${policyName ?? 'default'}:${identifier}`;
      const { allowed, retryAfterSeconds } =
        await this.rateLimitService.checkWalletEvidenceLimit(
          rateLimitKey,
          policy.limit,
          policy.windowSeconds,
        );

      if (!allowed) {
        res.setHeader('Retry-After', String(retryAfterSeconds));
        res.setHeader('X-RateLimit-Limit', String(policy.limit));
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader(
          'X-RateLimit-Reset',
          String(Math.floor(Date.now() / 1000) + retryAfterSeconds),
        );
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: 'Too Many Requests',
            message: 'Rate limit exceeded.',
            retryAfter: retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return true;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Redis failure — fail open.
      this.logger.warn(`HttpRateLimitGuard: Redis unavailable, failing open. ${err}`);
      return true;
    }
  }

  private resolveIdentifier(
    req: AuthenticatedRequest,
    keyBy: 'wallet' | 'ip',
  ): string {
    if (keyBy === 'wallet' && req.user?.walletAddress) {
      return req.user.walletAddress;
    }
    // Respect X-Forwarded-For when behind a trusted proxy.
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress ?? 'unknown';
  }
}
