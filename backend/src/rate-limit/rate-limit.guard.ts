import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';
import { RateLimitException } from './rate-limit.exception';
import { SorobanService } from '../rpc/soroban.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly rateLimitService: RateLimitService,
    private readonly soroban: SorobanService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const { policyId } = request.body;

    // If policyId is missing, let validation handle it
    if (!policyId) {
      return true;
    }

    try {
      // Get current ledger from Soroban
      const currentLedger = await this.soroban.getLatestLedger();

      // Check rate limit and increment counter
      const result = await this.rateLimitService.checkAndIncrement(
        policyId,
        currentLedger,
      );

      if (!result.allowed) {
        throw new RateLimitException({
          policyId,
          currentCount: result.currentCount,
          limit: result.limit,
          windowResetLedger: result.windowResetLedger,
          remainingLedgers: result.windowResetLedger - currentLedger,
        });
      }

      return true;
    } catch (error) {
      // Re-throw RateLimitException
      if (error instanceof RateLimitException) {
        throw error;
      }

      // Log other errors and fail open
      this.logger.error(`Rate limit check failed: ${error}`);
      return true;
    }
  }
}
