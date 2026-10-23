import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { RateLimitService } from './rate-limit.service';
import { RateLimitException } from './rate-limit.exception';

/**
 * ClaimRateLimitGuard — per-wallet sliding window rate limit for claim filing.
 *
 * Enforces:
 *   MAX_CLAIMS_PER_WALLET_PER_HOUR  (env, default 3)
 *   MAX_CLAIMS_PER_WALLET_PER_DAY   (env, default 20)
 *
 * Returns 429 with Retry-After and X-RateLimit-* headers on limit exceeded.
 * Rate limits are wallet-scoped and independent of IP-based limits.
 */
@Injectable()
export class ClaimRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(ClaimRateLimitGuard.name);

  constructor(
    private readonly rateLimitService: RateLimitService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user?: { walletAddress?: string }; body?: { holder?: string } }>();
    const res = context.switchToHttp().getResponse<Response>();

    const wallet = req.user?.walletAddress ?? req.body?.holder;
    if (!wallet) return true; // let auth guard handle missing wallet

    const hourLimit = this.config.get<number>('MAX_CLAIMS_PER_WALLET_PER_HOUR', 3);
    const dayLimit = this.config.get<number>('MAX_CLAIMS_PER_WALLET_PER_DAY', 20);

    try {
      // Hourly check
      const hourCheck = await this.rateLimitService.checkWalletEvidenceLimit(
        `claim:hour:${wallet}`,
        hourLimit,
        3600,
      );
      if (!hourCheck.allowed) {
        this.setHeaders(res, hourLimit, hourCheck.retryAfterSeconds);
        throw new RateLimitException({
          policyId: wallet,
          currentCount: hourLimit,
          limit: hourLimit,
          windowResetLedger: 0,
          remainingLedgers: 0,
          retryAfterSeconds: hourCheck.retryAfterSeconds,
          limitType: 'wallet',
        });
      }

      // Daily check
      const dayCheck = await this.rateLimitService.checkWalletEvidenceLimit(
        `claim:day:${wallet}`,
        dayLimit,
        86400,
      );
      if (!dayCheck.allowed) {
        this.setHeaders(res, dayLimit, dayCheck.retryAfterSeconds);
        throw new RateLimitException({
          policyId: wallet,
          currentCount: dayLimit,
          limit: dayLimit,
          windowResetLedger: 0,
          remainingLedgers: 0,
          retryAfterSeconds: dayCheck.retryAfterSeconds,
          limitType: 'wallet',
        });
      }

      res.setHeader('X-RateLimit-Limit-Hour', String(hourLimit));
      res.setHeader('X-RateLimit-Limit-Day', String(dayLimit));
      return true;
    } catch (err) {
      if (err instanceof RateLimitException) throw err;
      this.logger.error(`ClaimRateLimitGuard error: ${err}`);
      return true; // fail open
    }
  }

  private setHeaders(res: Response, limit: number, retryAfter: number) {
    res.setHeader('Retry-After', String(retryAfter));
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', '0');
    res.setHeader('X-RateLimit-Reset', String(Math.floor(Date.now() / 1000) + retryAfter));
  }
}
