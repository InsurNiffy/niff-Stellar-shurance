import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { RateLimitService } from './rate-limit.service';
import { RateLimitException } from './rate-limit.exception';

/**
 * AppealRateLimitGuard — dedicated per-wallet throttle for appeal submission.
 *
 * Why a separate tier from ClaimRateLimitGuard (#1322):
 *   Appeals are rarer and higher-stakes than ordinary claim filing. Sharing the
 *   claim-submission window (5/hour, 20/day) would let a wallet burn most of its
 *   claim budget on appeal spam, or conversely make a legitimate claim+appeal
 *   sequence trip the shared counter. A stricter, isolated window keeps appeal
 *   abuse expensive without punishing normal claim traffic.
 *
 * Defaults (env-overridable):
 *   MAX_APPEALS_PER_WALLET_PER_HOUR = 2
 *   MAX_APPEALS_PER_WALLET_PER_DAY   = 5
 *
 * Redis keys are namespaced under `appeal:` so they never share counters with
 * `claim:` keys used by ClaimRateLimitGuard.
 */
@Injectable()
export class AppealRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(AppealRateLimitGuard.name);

  constructor(
    private readonly rateLimitService: RateLimitService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      user?: { walletAddress?: string };
      body?: { claimant?: string; walletAddress?: string; holder?: string };
    }>();
    const res = context.switchToHttp().getResponse<Response>();

    const wallet =
      req.user?.walletAddress ??
      req.body?.claimant ??
      req.body?.walletAddress ??
      req.body?.holder;
    if (!wallet) return true; // let auth guard handle missing wallet

    const hourLimit = this.config.get<number>('MAX_APPEALS_PER_WALLET_PER_HOUR', 2);
    const dayLimit = this.config.get<number>('MAX_APPEALS_PER_WALLET_PER_DAY', 5);

    try {
      const hourCheck = await this.rateLimitService.checkWalletEvidenceLimit(
        `appeal:hour:${wallet}`,
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

      const dayCheck = await this.rateLimitService.checkWalletEvidenceLimit(
        `appeal:day:${wallet}`,
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
      res.setHeader('X-RateLimit-Policy', 'appeal');
      return true;
    } catch (err) {
      if (err instanceof RateLimitException) throw err;
      this.logger.error(`AppealRateLimitGuard error: ${err}`);
      return true; // fail open
    }
  }

  private setHeaders(res: Response, limit: number, retryAfter: number) {
    res.setHeader('Retry-After', String(retryAfter));
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', '0');
    res.setHeader('X-RateLimit-Reset', String(Math.floor(Date.now() / 1000) + retryAfter));
    res.setHeader('X-RateLimit-Policy', 'appeal');
  }
}
